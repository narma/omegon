//! Agent evaluation framework — score agent bundles against test scenarios.
//!
//! Usage: `omegon eval --agent <id> --suite <path>`
//!
//! The harness spawns the agent as a daemon, feeds it test scenarios via
//! the HTTP event API, collects results, and runs scorers to produce a
//! score card.

pub mod scenario;
pub mod scorer;
pub mod report;

use std::path::Path;

use scenario::{EvalSuite, Scenario};
use scorer::ScorerResult;
use report::{ScenarioResult, ScoreCard};

/// Run an eval suite against an agent bundle.
pub async fn run_suite(
    agent_id: &str,
    suite_path: &Path,
) -> anyhow::Result<ScoreCard> {
    let suite = EvalSuite::load(suite_path)?;
    tracing::info!(
        suite = %suite.suite.name,
        scenarios = suite.scenarios.len(),
        "starting eval suite"
    );

    let mut results = Vec::new();

    for scenario_ref in &suite.scenarios {
        let scenario_path = suite_path.parent().unwrap_or(Path::new(".")).join(&scenario_ref.path);
        let scenario = Scenario::load(&scenario_path)?;

        tracing::info!(
            scenario = %scenario.scenario.name,
            difficulty = scenario.scenario.difficulty,
            "running scenario"
        );

        let result = run_scenario(agent_id, &scenario).await;
        match result {
            Ok(r) => {
                tracing::info!(
                    scenario = %scenario.scenario.name,
                    score = r.weighted_score,
                    passed = r.passed,
                    turns = r.turns,
                    "scenario complete"
                );
                results.push(r);
            }
            Err(e) => {
                tracing::error!(
                    scenario = %scenario.scenario.name,
                    error = %e,
                    "scenario failed"
                );
                results.push(ScenarioResult {
                    name: scenario.scenario.name.clone(),
                    difficulty: scenario.scenario.difficulty,
                    scores: std::collections::HashMap::new(),
                    weighted_score: 0.0,
                    turns: 0,
                    tokens: 0,
                    duration_secs: 0.0,
                    passed: false,
                    error: Some(e.to_string()),
                });
            }
        }
    }

    Ok(ScoreCard::from_results(agent_id, &suite.suite.name, results))
}

/// Run a single scenario. In this initial implementation, we run the
/// scenario in-process (no daemon spawn) by evaluating the scoring
/// rules against simulated/provided outputs. Full daemon integration
/// comes in a follow-up.
async fn run_scenario(
    _agent_id: &str,
    scenario: &Scenario,
) -> anyhow::Result<ScenarioResult> {
    let start = std::time::Instant::now();

    // For now, score the scenario structure itself (validation).
    // Full daemon-driven execution will call POST /api/events and
    // poll /api/state — using the same pattern as daemon_serve_blackbox.rs.
    let mut scores = std::collections::HashMap::new();
    let mut total_weight = 0.0;
    let mut weighted_sum = 0.0;

    for (name, rule) in &scenario.scoring {
        let score = scorer::evaluate_offline(rule);
        total_weight += rule.weight();
        weighted_sum += score * rule.weight();
        scores.insert(name.clone(), score);
    }

    let weighted_score = if total_weight > 0.0 {
        weighted_sum / total_weight
    } else {
        0.0
    };

    Ok(ScenarioResult {
        name: scenario.scenario.name.clone(),
        difficulty: scenario.scenario.difficulty,
        scores,
        weighted_score,
        turns: 0,
        tokens: 0,
        duration_secs: start.elapsed().as_secs_f64(),
        passed: weighted_score >= 0.5,
        error: None,
    })
}

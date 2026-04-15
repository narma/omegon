//! Score card generation and reporting.

use std::collections::HashMap;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ScoreCard {
    pub agent_id: String,
    pub suite: String,
    pub timestamp: String,
    pub scenarios: Vec<ScenarioResult>,
    pub aggregate: AggregateScore,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScenarioResult {
    pub name: String,
    pub difficulty: u8,
    pub scores: HashMap<String, f64>,
    pub weighted_score: f64,
    pub turns: u32,
    pub tokens: u64,
    pub duration_secs: f64,
    pub passed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AggregateScore {
    pub total_score: f64,
    pub pass_rate: f64,
    pub avg_turns: f64,
    pub avg_tokens: f64,
    pub by_difficulty: HashMap<String, f64>,
    pub by_dimension: HashMap<String, f64>,
}

impl ScoreCard {
    pub fn from_results(agent_id: &str, suite: &str, scenarios: Vec<ScenarioResult>) -> Self {
        let aggregate = compute_aggregate(&scenarios);
        Self {
            agent_id: agent_id.to_string(),
            suite: suite.to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            scenarios,
            aggregate,
        }
    }

    /// Human-readable summary.
    pub fn summary(&self) -> String {
        let mut out = String::new();
        out.push_str(&format!(
            "Agent: {}  Suite: {}  Score: {:.0}%  Pass: {:.0}%\n",
            self.agent_id,
            self.suite,
            self.aggregate.total_score * 100.0,
            self.aggregate.pass_rate * 100.0,
        ));
        out.push_str(&format!(
            "Scenarios: {}  Avg turns: {:.1}  Avg tokens: {:.0}\n\n",
            self.scenarios.len(),
            self.aggregate.avg_turns,
            self.aggregate.avg_tokens,
        ));

        for s in &self.scenarios {
            let status = if s.passed { "PASS" } else { "FAIL" };
            out.push_str(&format!(
                "  [{status}] {} (L{}) — {:.0}%",
                s.name, s.difficulty, s.weighted_score * 100.0
            ));
            if let Some(ref e) = s.error {
                out.push_str(&format!(" — error: {e}"));
            }
            out.push('\n');
        }

        if !self.aggregate.by_dimension.is_empty() {
            out.push_str("\nDimensions:\n");
            let mut dims: Vec<_> = self.aggregate.by_dimension.iter().collect();
            dims.sort_by_key(|(k, _)| k.clone());
            for (dim, score) in dims {
                out.push_str(&format!("  {dim}: {:.0}%\n", score * 100.0));
            }
        }

        out
    }
}

fn compute_aggregate(scenarios: &[ScenarioResult]) -> AggregateScore {
    if scenarios.is_empty() {
        return AggregateScore {
            total_score: 0.0,
            pass_rate: 0.0,
            avg_turns: 0.0,
            avg_tokens: 0.0,
            by_difficulty: HashMap::new(),
            by_dimension: HashMap::new(),
        };
    }

    let n = scenarios.len() as f64;
    let total_score = scenarios.iter().map(|s| s.weighted_score).sum::<f64>() / n;
    let pass_rate = scenarios.iter().filter(|s| s.passed).count() as f64 / n;
    let avg_turns = scenarios.iter().map(|s| s.turns as f64).sum::<f64>() / n;
    let avg_tokens = scenarios.iter().map(|s| s.tokens as f64).sum::<f64>() / n;

    // By difficulty
    let mut by_diff: HashMap<u8, Vec<f64>> = HashMap::new();
    for s in scenarios {
        by_diff.entry(s.difficulty).or_default().push(s.weighted_score);
    }
    let by_difficulty: HashMap<String, f64> = by_diff
        .into_iter()
        .map(|(d, scores)| {
            let avg = scores.iter().sum::<f64>() / scores.len() as f64;
            (d.to_string(), avg)
        })
        .collect();

    // By dimension
    let mut by_dim: HashMap<String, Vec<f64>> = HashMap::new();
    for s in scenarios {
        for (dim, score) in &s.scores {
            by_dim.entry(dim.clone()).or_default().push(*score);
        }
    }
    let by_dimension: HashMap<String, f64> = by_dim
        .into_iter()
        .map(|(dim, scores)| {
            let avg = scores.iter().sum::<f64>() / scores.len() as f64;
            (dim, avg)
        })
        .collect();

    AggregateScore {
        total_score,
        pass_rate,
        avg_turns,
        avg_tokens,
        by_difficulty,
        by_dimension,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregate_computation() {
        let scenarios = vec![
            ScenarioResult {
                name: "easy".into(),
                difficulty: 1,
                scores: HashMap::from([("correctness".into(), 1.0), ("efficiency".into(), 0.8)]),
                weighted_score: 0.9,
                turns: 3,
                tokens: 1000,
                duration_secs: 10.0,
                passed: true,
                error: None,
            },
            ScenarioResult {
                name: "hard".into(),
                difficulty: 3,
                scores: HashMap::from([("correctness".into(), 0.5), ("efficiency".into(), 0.3)]),
                weighted_score: 0.4,
                turns: 8,
                tokens: 3000,
                duration_secs: 30.0,
                passed: false,
                error: None,
            },
        ];

        let card = ScoreCard::from_results("test-agent", "test-suite", scenarios);
        assert_eq!(card.aggregate.pass_rate, 0.5);
        assert!((card.aggregate.total_score - 0.65).abs() < 0.01);
        assert!((card.aggregate.avg_turns - 5.5).abs() < 0.01);

        let summary = card.summary();
        assert!(summary.contains("test-agent"));
        assert!(summary.contains("PASS"));
        assert!(summary.contains("FAIL"));
    }
}

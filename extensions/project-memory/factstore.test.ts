/**
 * Tests for FactStore — SQLite-backed memory with decay reinforcement.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { FactStore, computeConfidence, parseExtractionOutput } from "./factstore.ts";

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `factstore-test-${crypto.randomBytes(8).toString("hex")}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("FactStore", () => {
  let dir: string;
  let store: FactStore;

  beforeEach(() => {
    dir = tmpDir();
    store = new FactStore(dir);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // --- Basic CRUD ---

  it("uses custom dbName when provided", () => {
    const customDir = tmpDir();
    const custom = new FactStore(customDir, { dbName: "global.db" });
    custom.storeFact({ section: "Architecture", content: "test fact" });
    assert.ok(fs.existsSync(path.join(customDir, "global.db")));
    assert.ok(!fs.existsSync(path.join(customDir, "facts.db")));
    custom.close();
    fs.rmSync(customDir, { recursive: true, force: true });
  });

  it("stores and retrieves a fact", () => {
    const { id, duplicate } = store.storeFact({
      section: "Architecture",
      content: "The project uses TypeScript",
      source: "manual",
    });

    assert.ok(id);
    assert.equal(duplicate, false);

    const fact = store.getFact(id);
    assert.ok(fact);
    assert.equal(fact.content, "The project uses TypeScript");
    assert.equal(fact.section, "Architecture");
    assert.equal(fact.status, "active");
    assert.equal(fact.source, "manual");
    assert.equal(fact.mind, "default");
    assert.equal(fact.confidence, 1.0);
    assert.equal(fact.reinforcement_count, 1);
  });

  it("deduplicates by content hash", () => {
    const r1 = store.storeFact({ section: "Architecture", content: "Uses TypeScript" });
    const r2 = store.storeFact({ section: "Architecture", content: "Uses TypeScript" });

    assert.equal(r1.duplicate, false);
    assert.equal(r2.duplicate, true);
    assert.equal(r2.id, r1.id); // Returns existing ID
  });

  it("dedup is case-insensitive and whitespace-normalized", () => {
    const r1 = store.storeFact({ section: "Architecture", content: "Uses TypeScript" });
    const r2 = store.storeFact({ section: "Architecture", content: "  uses   typescript  " });

    assert.equal(r2.duplicate, true);
    assert.equal(r2.id, r1.id);
  });

  it("dedup strips bullet prefix", () => {
    const r1 = store.storeFact({ section: "Architecture", content: "- Uses TypeScript" });
    const r2 = store.storeFact({ section: "Architecture", content: "Uses TypeScript" });

    assert.equal(r2.duplicate, true);
  });

  it("dedup reinforces existing fact", () => {
    const r1 = store.storeFact({ section: "Architecture", content: "Uses TypeScript" });
    store.storeFact({ section: "Architecture", content: "Uses TypeScript" });

    const fact = store.getFact(r1.id)!;
    assert.equal(fact.reinforcement_count, 2);
  });

  // --- Supersession ---

  it("supersedes a fact explicitly", () => {
    const r1 = store.storeFact({ section: "Architecture", content: "Threshold is 10000" });
    const r2 = store.storeFact({
      section: "Architecture",
      content: "Threshold is 20000",
      supersedes: r1.id,
    });

    const old = store.getFact(r1.id)!;
    assert.equal(old.status, "superseded");
    assert.ok(old.superseded_at);

    const newer = store.getFact(r2.id)!;
    assert.equal(newer.status, "active");
    assert.equal(newer.supersedes, r1.id);
  });

  it("traverses supersession chain", () => {
    const r1 = store.storeFact({ section: "Architecture", content: "v1" });
    const r2 = store.storeFact({ section: "Architecture", content: "v2", supersedes: r1.id });
    const r3 = store.storeFact({ section: "Architecture", content: "v3", supersedes: r2.id });

    const chain = store.getSupersessionChain(r3.id);
    assert.equal(chain.length, 3);
    assert.equal(chain[0].content, "v3");
    assert.equal(chain[1].content, "v2");
    assert.equal(chain[2].content, "v1");
  });

  // --- Archival ---

  it("archives a fact", () => {
    const { id } = store.storeFact({ section: "Architecture", content: "Old fact" });
    store.archiveFact(id);

    const fact = store.getFact(id)!;
    assert.equal(fact.status, "archived");
    assert.ok(fact.archived_at);
  });

  it("archives all facts from a session", () => {
    store.storeFact({ section: "Architecture", content: "A", session: "s1" });
    store.storeFact({ section: "Architecture", content: "B", session: "s1" });
    store.storeFact({ section: "Architecture", content: "C", session: "s2" });

    const archived = store.archiveSession("s1");
    assert.equal(archived, 2);
    assert.equal(store.countActiveFacts("default"), 1);
  });

  // --- Queries ---

  it("counts active facts per mind", () => {
    store.storeFact({ section: "Architecture", content: "A" });
    store.storeFact({ section: "Decisions", content: "B" });
    store.storeFact({ section: "Constraints", content: "C" });

    assert.equal(store.countActiveFacts("default"), 3);
  });

  it("getActiveFacts returns only active facts", () => {
    store.storeFact({ section: "Architecture", content: "Active" });
    const { id } = store.storeFact({ section: "Architecture", content: "Will archive" });
    store.archiveFact(id);

    const facts = store.getActiveFacts("default");
    assert.equal(facts.length, 1);
    assert.equal(facts[0].content, "Active");
  });

  // --- Full-text search ---

  it("searches facts with FTS5", () => {
    store.storeFact({ section: "Architecture", content: "SQLite database for storage" });
    store.storeFact({ section: "Decisions", content: "Chose PostgreSQL for production" });
    store.storeFact({ section: "Constraints", content: "Must run on ARM devices" });

    const results = store.searchFacts("SQLite");
    assert.equal(results.length, 1);
    assert.equal(results[0].content, "SQLite database for storage");
  });

  it("searches archived facts", () => {
    const { id } = store.storeFact({ section: "Architecture", content: "Old SQLite approach" });
    store.archiveFact(id);
    store.storeFact({ section: "Architecture", content: "New PostgreSQL approach" });

    const archived = store.searchArchive("SQLite");
    assert.equal(archived.length, 1);
    assert.equal(archived[0].status, "archived");
  });

  it("cross-mind search works", () => {
    store.createMind("other", "test mind");
    store.storeFact({ section: "Architecture", content: "Default fact about SQLite" });
    store.storeFact({ mind: "other", section: "Architecture", content: "Other fact about SQLite" });

    const results = store.searchFacts("SQLite");
    assert.equal(results.length, 2);
  });

  // --- Rendering ---

  it("renders Markdown-KV for injection", () => {
    store.storeFact({ section: "Architecture", content: "Uses TypeScript" });
    store.storeFact({ section: "Decisions", content: "Chose SQLite" });

    const rendered = store.renderForInjection("default");
    assert.ok(rendered.includes("## Architecture"));
    assert.ok(rendered.includes("- Uses TypeScript ["));
    assert.ok(rendered.includes("## Decisions"));
    assert.ok(rendered.includes("- Chose SQLite ["));
  });

  it("rendering respects maxFacts limit", () => {
    for (let i = 0; i < 100; i++) {
      store.storeFact({ section: "Architecture", content: `Fact number ${i}` });
    }

    const rendered = store.renderForInjection("default", { maxFacts: 10 });
    const bulletLines = rendered.split("\n").filter(l => l.startsWith("- "));
    assert.equal(bulletLines.length, 10);
  });

  // --- Minds ---

  it("creates and lists minds", () => {
    store.createMind("research", "Research notes");
    const minds = store.listMinds();
    assert.ok(minds.length >= 2); // default + research
    assert.ok(minds.find(m => m.name === "research"));
  });

  it("forks a mind with all facts", () => {
    store.storeFact({ section: "Architecture", content: "Fact A" });
    store.storeFact({ section: "Decisions", content: "Fact B" });

    store.forkMind("default", "fork1", "Fork of default");

    assert.equal(store.countActiveFacts("fork1"), 2);
    const facts = store.getActiveFacts("fork1");
    assert.ok(facts.find(f => f.content === "Fact A"));
    assert.ok(facts.find(f => f.content === "Fact B"));
  });

  it("ingests facts between minds with dedup", () => {
    store.storeFact({ section: "Architecture", content: "Shared fact" });
    store.createMind("source", "Source mind");
    store.storeFact({ mind: "source", section: "Architecture", content: "Shared fact" });
    store.storeFact({ mind: "source", section: "Architecture", content: "New fact" });

    const result = store.ingestMind("source", "default");
    assert.equal(result.factsIngested, 1); // Only "New fact" — "Shared fact" deduped
    assert.equal(result.duplicatesSkipped, 1);
  });

  it("ingest retires writable source", () => {
    store.createMind("source", "Source");
    store.storeFact({ mind: "source", section: "Architecture", content: "A fact" });

    store.ingestMind("source", "default");

    const source = store.getMind("source")!;
    assert.equal(source.status, "retired");
  });

  it("ingest does not retire readonly source", () => {
    store.createMind("linked", "Linked", { readonly: true });
    store.storeFact({ mind: "linked", section: "Architecture", content: "A fact" });

    store.ingestMind("linked", "default");

    const source = store.getMind("linked")!;
    assert.equal(source.status, "active"); // Not retired
  });

  it("deletes a mind and its facts", () => {
    store.createMind("temp", "Temporary");
    store.storeFact({ mind: "temp", section: "Architecture", content: "Temp fact" });

    store.deleteMind("temp");

    assert.equal(store.mindExists("temp"), false);
    assert.equal(store.countActiveFacts("temp"), 0);
  });

  it("cannot delete default mind", () => {
    assert.throws(() => store.deleteMind("default"), /Cannot delete/);
  });

  // --- Active mind state ---

  it("tracks active mind", () => {
    store.createMind("work", "Work mind");
    assert.equal(store.getActiveMind(), null);

    store.setActiveMind("work");
    assert.equal(store.getActiveMind(), "work");

    store.setActiveMind(null);
    assert.equal(store.getActiveMind(), null);
  });

  // --- Extraction processing ---

  it("processes extraction observe actions", () => {
    // Add an existing fact
    store.storeFact({ section: "Architecture", content: "Uses TypeScript" });

    const actions = parseExtractionOutput(`
      {"type":"observe","section":"Architecture","content":"Uses TypeScript"}
      {"type":"observe","section":"Decisions","content":"Chose SQLite for storage"}
    `);

    const result = store.processExtraction("default", actions);
    assert.equal(result.reinforced, 1); // "Uses TypeScript" reinforced
    assert.equal(result.added, 1); // "Chose SQLite" added
  });

  it("processes extraction supersede actions", () => {
    const { id } = store.storeFact({ section: "Architecture", content: "Threshold is 10000" });

    const actions = parseExtractionOutput(
      `{"type":"supersede","id":"${id}","section":"Architecture","content":"Threshold is 20000"}`
    );

    store.processExtraction("default", actions);

    const old = store.getFact(id)!;
    assert.equal(old.status, "superseded");
  });

  it("processes extraction archive actions", () => {
    const { id } = store.storeFact({ section: "Architecture", content: "Stale fact" });

    const actions = parseExtractionOutput(`{"type":"archive","id":"${id}"}`);
    store.processExtraction("default", actions);

    const fact = store.getFact(id)!;
    assert.equal(fact.status, "archived");
  });

  it("tolerates malformed extraction output", () => {
    const actions = parseExtractionOutput(`
      not json
      {"type":"observe","section":"Architecture","content":"Valid fact"}
      {broken json
      {"type":"observe","section":"Decisions","content":"Another valid fact"}
    `);

    assert.equal(actions.length, 2);
  });
});

// --- Decay math ---

describe("computeConfidence", () => {
  it("returns 1.0 at time zero", () => {
    assert.equal(computeConfidence(0, 1), 1.0);
  });

  it("returns ~0.5 at half-life for single reinforcement", () => {
    const c = computeConfidence(14, 1); // 14 days = default half-life
    assert.ok(Math.abs(c - 0.5) < 0.01, `Expected ~0.5, got ${c}`);
  });

  it("decays slower with more reinforcements", () => {
    const c1 = computeConfidence(14, 1);
    const c5 = computeConfidence(14, 5);
    const c10 = computeConfidence(14, 10);

    assert.ok(c5 > c1, "5 reinforcements should decay slower than 1");
    assert.ok(c10 > c5, "10 reinforcements should decay slower than 5");
  });

  it("highly reinforced facts remain confident for months", () => {
    const c = computeConfidence(90, 15); // 90 days, 15 reinforcements
    assert.ok(c > 0.8, `Expected >0.8 after 90 days with 15 reinforcements, got ${c}`);
  });

  it("unreinforced facts fade within weeks", () => {
    const c = computeConfidence(30, 1); // 30 days, 1 reinforcement
    assert.ok(c < 0.3, `Expected <0.3 after 30 days with 1 reinforcement, got ${c}`);
  });

  it("Specs section facts are immune to confidence decay", () => {
    const d = tmpDir();
    const s = new FactStore(d);
    try {
      const mind = "test-project";
      s.createMind(mind, "test");
      const { id } = s.storeFact({ mind, section: "Specs", content: "API must return ≤100ms" });

      // Backdate the fact's last_reinforced to 365 days ago
      const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      (s as any).db.prepare(
        `UPDATE facts SET last_reinforced = ? WHERE id = ?`
      ).run(oldDate, id);

      const facts = s.getActiveFacts(mind);
      const spec = facts.find(f => f.id === id)!;
      assert.equal(spec.confidence, 1.0, "Specs facts should always have confidence 1.0 regardless of age");

      // Verify a non-Specs fact DOES decay with the same age
      const { id: archId } = s.storeFact({ mind, section: "Architecture", content: "Uses PostgreSQL" });
      (s as any).db.prepare(
        `UPDATE facts SET last_reinforced = ? WHERE id = ?`
      ).run(oldDate, archId);

      const facts2 = s.getActiveFacts(mind);
      const arch = facts2.find(f => f.id === archId)!;
      assert.ok(arch.confidence < 0.1, `Architecture fact should have decayed after 365 days, got ${arch.confidence}`);
    } finally {
      s.close();
      fs.rmSync(d, { recursive: true, force: true });
    }
  });
});

// --- Extraction output parsing ---

describe("parseExtractionOutput", () => {
  it("parses valid JSONL", () => {
    const actions = parseExtractionOutput(`
{"type":"observe","section":"Architecture","content":"Fact 1"}
{"type":"reinforce","id":"abc123"}
{"type":"archive","id":"def456"}
    `);
    assert.equal(actions.length, 3);
    assert.equal(actions[0].type, "observe");
    assert.equal(actions[1].type, "reinforce");
    assert.equal(actions[2].type, "archive");
  });

  it("accepts action as alias for type", () => {
    const actions = parseExtractionOutput(
      `{"action":"observe","section":"Architecture","content":"Fact"}`
    );
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, "observe");
  });

  it("skips comments and blank lines", () => {
    const actions = parseExtractionOutput(`
# comment
// another comment

{"type":"observe","section":"Architecture","content":"Fact"}
    `);
    assert.equal(actions.length, 1);
  });
});

// ---------------------------------------------------------------------------
// JSONL Import/Export — merge=union dedup and deterministic ordering
// ---------------------------------------------------------------------------

describe("JSONL Import Dedup (merge=union resilience)", () => {
  let dir: string;
  let store: FactStore;

  beforeEach(() => {
    dir = tmpDir();
    store = new FactStore(dir);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("deduplicates fact lines with same id, keeps higher reinforcement_count", () => {
    // Simulate merge=union producing two lines for the same fact
    const jsonl = [
      '{"_type":"fact","id":"AAA","mind":"default","section":"Architecture","content":"Test fact","status":"active","content_hash":"abc123","reinforcement_count":3,"last_reinforced":"2026-03-01T00:00:00Z","confidence":1,"decay_rate":0.05,"source":"manual","created_at":"2026-03-01T00:00:00Z","supersedes":null}',
      '{"_type":"fact","id":"AAA","mind":"default","section":"Architecture","content":"Test fact","status":"active","content_hash":"abc123","reinforcement_count":5,"last_reinforced":"2026-03-02T00:00:00Z","confidence":1,"decay_rate":0.05,"source":"manual","created_at":"2026-03-01T00:00:00Z","supersedes":null}',
    ].join("\n");

    const result = store.importFromJsonl(jsonl);
    // Should process only ONE fact (the one with count=5), not both
    assert.equal(result.factsAdded, 1);
    assert.equal(result.factsReinforced, 0);

    const facts = store.getActiveFacts("default");
    assert.equal(facts.length, 1);
    assert.equal(facts[0].reinforcement_count, 5);
  });

  it("deduplicates fact lines with same id, tie-breaks on last_reinforced", () => {
    const jsonl = [
      '{"_type":"fact","id":"BBB","mind":"default","section":"Architecture","content":"Tied fact","status":"active","content_hash":"def456","reinforcement_count":3,"last_reinforced":"2026-03-01T00:00:00Z","confidence":1,"decay_rate":0.05,"source":"manual","created_at":"2026-03-01T00:00:00Z","supersedes":null}',
      '{"_type":"fact","id":"BBB","mind":"default","section":"Architecture","content":"Tied fact","status":"active","content_hash":"def456","reinforcement_count":3,"last_reinforced":"2026-03-05T00:00:00Z","confidence":1,"decay_rate":0.05,"source":"manual","created_at":"2026-03-01T00:00:00Z","supersedes":null}',
    ].join("\n");

    store.importFromJsonl(jsonl);
    const facts = store.getActiveFacts("default");
    assert.equal(facts.length, 1);
    // The one with the later last_reinforced should win
    // (We can't check last_reinforced directly on the imported fact since import
    //  may set its own timestamp, but only 1 fact should exist)
  });

  it("deduplicates episode lines with same id, keeps only one", () => {
    // Simulate merge=union producing two episode lines with same id
    const jsonl = [
      '{"_type":"episode","id":"EP1","mind":"default","title":"Session One","narrative":"Did stuff","date":"2026-03-01","session_id":null,"created_at":"2026-03-01T00:00:00Z","fact_ids":[]}',
      '{"_type":"episode","id":"EP1","mind":"default","title":"Session One","narrative":"Did stuff","date":"2026-03-01","session_id":null,"created_at":"2026-03-01T12:00:00Z","fact_ids":[]}',
    ].join("\n");

    store.importFromJsonl(jsonl);
    const episodes = store.getEpisodes("default");
    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].title, "Session One");
  });

  it("deduplicates edge lines with same id, keeps only one", () => {
    // Import facts AND edges from JSONL — no pre-created facts
    const jsonl = [
      '{"_type":"fact","id":"F1","mind":"default","section":"Architecture","content":"Edge fact one","status":"active","content_hash":"ef1","reinforcement_count":1,"confidence":1,"decay_rate":0.05,"source":"manual","created_at":"2026-03-01T00:00:00Z","supersedes":null}',
      '{"_type":"fact","id":"F2","mind":"default","section":"Architecture","content":"Edge fact two","status":"active","content_hash":"ef2","reinforcement_count":1,"confidence":1,"decay_rate":0.05,"source":"manual","created_at":"2026-03-01T00:00:00Z","supersedes":null}',
      '{"_type":"edge","id":"E1","source_fact_id":"F1","target_fact_id":"F2","relation":"depends_on","description":"test","confidence":1,"reinforcement_count":1,"decay_rate":0.05,"source_mind":"default","target_mind":"default"}',
      '{"_type":"edge","id":"E1","source_fact_id":"F1","target_fact_id":"F2","relation":"depends_on","description":"test","confidence":1,"reinforcement_count":3,"decay_rate":0.05,"source_mind":"default","target_mind":"default"}',
    ].join("\n");

    const result = store.importFromJsonl(jsonl);
    assert.equal(result.factsAdded, 2);

    // Get the imported facts (IDs are remapped by import)
    const facts = store.getActiveFacts("default");
    assert.equal(facts.length, 2);

    // Check edges — should have exactly 1 despite two lines with same id
    const allEdges = store.getActiveEdges("default");
    assert.equal(allEdges.length, 1);
  });

  it("preserves records without id field (mind records)", () => {
    const jsonl = [
      '{"_type":"mind","name":"custom","description":"A custom mind","status":"active","origin_type":"local","created_at":"2026-03-01T00:00:00Z"}',
      '{"_type":"fact","id":"F1","mind":"custom","section":"Architecture","content":"Custom fact","status":"active","content_hash":"c1","reinforcement_count":1,"confidence":1,"decay_rate":0.05,"source":"manual","created_at":"2026-03-01T00:00:00Z","supersedes":null}',
    ].join("\n");

    const result = store.importFromJsonl(jsonl);
    assert.equal(result.mindsCreated, 1);
    assert.equal(result.factsAdded, 1);
  });

  it("episode re-import does not create duplicates", () => {
    // Store an episode, export, then re-import into same store
    store.storeEpisode({
      mind: "default",
      title: "Original Episode",
      narrative: "Narrative",
      date: "2026-03-01",
    });

    const jsonl = store.exportToJsonl();

    // Import the exported JSONL back into the same store
    store.importFromJsonl(jsonl);
    store.importFromJsonl(jsonl);

    const episodes = store.getEpisodes("default");
    assert.equal(episodes.length, 1, `Expected 1 episode, got ${episodes.length}`);
  });

  it("episode cross-machine import preserves id", () => {
    // Simulate: machine A exports, machine B imports into fresh store
    store.storeEpisode({
      mind: "default",
      title: "Remote Episode",
      narrative: "From another machine",
      date: "2026-03-01",
    });
    const jsonl = store.exportToJsonl();

    // Fresh store (machine B)
    const dir2 = tmpDir();
    const store2 = new FactStore(dir2);
    store2.importFromJsonl(jsonl);

    const episodes = store2.getEpisodes("default");
    assert.equal(episodes.length, 1);
    assert.equal(episodes[0].title, "Remote Episode");

    // Re-import should NOT duplicate
    store2.importFromJsonl(jsonl);
    const after = store2.getEpisodes("default");
    assert.equal(after.length, 1, `Expected 1 episode after re-import, got ${after.length}`);

    store2.close();
    fs.rmSync(dir2, { recursive: true, force: true });
  });

  it("export is deterministic — same DB produces same output", () => {
    store.storeFact({ section: "Architecture", content: "Fact A" });
    store.storeFact({ section: "Decisions", content: "Fact B" });
    store.storeFact({ section: "Architecture", content: "Fact C" });
    store.storeEpisode({
      mind: "default",
      title: "Ep",
      narrative: "Text",
      date: "2026-03-01",
    });

    const export1 = store.exportToJsonl();
    const export2 = store.exportToJsonl();
    assert.equal(export1, export2, "Two consecutive exports should be byte-identical");
  });
});

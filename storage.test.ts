/**
 * Tests for MemoryStorage (storage.ts)
 *
 * Uses real temp directories — no filesystem mocking.
 * Run with: npx tsx --test storage.test.ts
 */

import { describe, it, before, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

import { MemoryStorage } from "./storage.js";
import { DEFAULT_TEMPLATE, countContentLines } from "./template.js";
import { ARCHIVE_SEPARATOR } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function currentMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MemoryStorage", () => {
  let tmpDir: string;
  let storage: MemoryStorage;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    storage = new MemoryStorage(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // init()
  // -------------------------------------------------------------------------

  describe("init()", () => {
    it("creates the archive directory", () => {
      storage.init();
      assert.ok(
        fs.existsSync(storage.getArchiveDir()),
        "archive dir should exist after init"
      );
    });

    it("creates memory.md with the default template", () => {
      storage.init();
      const memoryFile = storage.getMemoryFilePath();
      assert.ok(fs.existsSync(memoryFile), "memory.md should exist after init");
      const content = fs.readFileSync(memoryFile, "utf8");
      assert.equal(content, DEFAULT_TEMPLATE);
    });

    it("does not overwrite an existing memory.md", () => {
      storage.init();
      const memoryFile = storage.getMemoryFilePath();
      const customContent = "# Custom memory content\n";
      fs.writeFileSync(memoryFile, customContent, "utf8");

      // Second init must leave file intact
      storage.init();
      const content = fs.readFileSync(memoryFile, "utf8");
      assert.equal(content, customContent, "init should not overwrite existing memory.md");
    });

    it("is idempotent when called multiple times on a clean dir", () => {
      storage.init();
      storage.init();
      storage.init();
      const memoryFile = storage.getMemoryFilePath();
      assert.ok(fs.existsSync(memoryFile), "memory.md should still exist");
      const content = fs.readFileSync(memoryFile, "utf8");
      assert.equal(content, DEFAULT_TEMPLATE, "content should equal DEFAULT_TEMPLATE");
    });
  });

  // -------------------------------------------------------------------------
  // readMemory()
  // -------------------------------------------------------------------------

  describe("readMemory()", () => {
    it("returns DEFAULT_TEMPLATE when memory.md does not exist", () => {
      // No init — file does not exist
      const content = storage.readMemory();
      assert.equal(content, DEFAULT_TEMPLATE);
    });

    it("returns the current memory.md content after init", () => {
      storage.init();
      const content = storage.readMemory();
      assert.equal(content, DEFAULT_TEMPLATE);
    });
  });

  // -------------------------------------------------------------------------
  // writeMemory() / readMemory() roundtrip
  // -------------------------------------------------------------------------

  describe("writeMemory() / readMemory() roundtrip", () => {
    it("writes and reads back the same content", () => {
      storage.init();
      const testContent = "## Architecture\n- Component A\n- Component B\n";
      storage.writeMemory(testContent);
      assert.equal(storage.readMemory(), testContent);
    });

    it("overwrites previous content on successive writes", () => {
      storage.init();
      storage.writeMemory("first content\n");
      storage.writeMemory("second content\n");
      assert.equal(storage.readMemory(), "second content\n");
    });

    it("preserves multi-line markdown with sections", () => {
      storage.init();
      const md =
        "## Architecture\n- Fact A\n\n## Decisions\n- Fact B\n<!-- comment -->\n";
      storage.writeMemory(md);
      assert.equal(storage.readMemory(), md);
    });
  });

  // -------------------------------------------------------------------------
  // writeExtractionResult()
  // -------------------------------------------------------------------------

  describe("writeExtractionResult()", () => {
    it("writes active memory (part before ARCHIVE_SEPARATOR) to memory.md", () => {
      storage.init();
      const activeContent = "## Architecture\n- Active fact\n";
      const archivedContent = "- Old fact 1\n";
      const result = `${activeContent}${ARCHIVE_SEPARATOR}\n${archivedContent}`;

      storage.writeExtractionResult(result);

      const memory = storage.readMemory();
      assert.ok(memory.includes("Active fact"), "memory should contain active content");
      assert.ok(!memory.includes("Old fact"), "memory should not contain archived content");
    });

    it("archives the part after ARCHIVE_SEPARATOR to the monthly archive file", () => {
      storage.init();
      const activeContent = "## Architecture\n- Active fact\n";
      const archivedContent = "- Archived fact\n";
      const result = `${activeContent}${ARCHIVE_SEPARATOR}\n${archivedContent}`;

      const { factsArchived } = storage.writeExtractionResult(result);

      assert.ok(factsArchived > 0, "factsArchived should be > 0");

      const archiveDir = storage.getArchiveDir();
      const archiveFiles = fs.readdirSync(archiveDir).filter((f) => f.endsWith(".md"));
      assert.ok(archiveFiles.length > 0, "should have created at least one archive file");

      const archiveContent = fs.readFileSync(
        path.join(archiveDir, archiveFiles[0]),
        "utf8"
      );
      assert.ok(archiveContent.includes("Archived fact"), "archive file should contain archived content");
    });

    it("does not create an archive file when there is no archived content", () => {
      storage.init();
      const activeContent = "## Architecture\n- Active fact\n";
      // No ARCHIVE_SEPARATOR — nothing to archive
      storage.writeExtractionResult(activeContent);

      const archiveDir = storage.getArchiveDir();
      const archiveFiles = fs.readdirSync(archiveDir).filter((f) => f.endsWith(".md"));
      assert.equal(
        archiveFiles.length,
        0,
        "no archive file should be created when archived section is empty"
      );
    });

    it("does not archive when content after separator is only whitespace", () => {
      storage.init();
      const result = `## Architecture\n- Fact\n${ARCHIVE_SEPARATOR}\n   \n`;

      const { factsArchived } = storage.writeExtractionResult(result);
      assert.equal(factsArchived, 0, "factsArchived should be 0 for blank archived section");

      const archiveDir = storage.getArchiveDir();
      const archiveFiles = fs.readdirSync(archiveDir).filter((f) => f.endsWith(".md"));
      assert.equal(archiveFiles.length, 0, "no archive file should be created");
    });

    it("returns correct linesWritten count (via countContentLines)", () => {
      storage.init();
      const activeContent = "## Architecture\n- Fact 1\n- Fact 2\n<!-- comment -->\n\n";
      const result = `${activeContent}${ARCHIVE_SEPARATOR}\n- Archived\n`;

      const { linesWritten } = storage.writeExtractionResult(result);

      // countContentLines on the trimmed active section
      const expected = countContentLines(activeContent.trim());
      assert.equal(linesWritten, expected);
    });

    it("returns correct factsArchived count (non-empty lines after separator)", () => {
      storage.init();
      const activeContent = "## Architecture\n- Fact\n";
      const archivedContent = "- Archived 1\n- Archived 2\n- Archived 3\n";
      const result = `${activeContent}${ARCHIVE_SEPARATOR}\n${archivedContent}`;

      const { factsArchived } = storage.writeExtractionResult(result);
      assert.equal(factsArchived, 3);
    });

    it("appends to existing archive file on second call", () => {
      storage.init();
      const mkResult = (a: string, b: string) =>
        `## Architecture\n- ${a}\n${ARCHIVE_SEPARATOR}\n- ${b}\n`;

      storage.writeExtractionResult(mkResult("Active 1", "Archive 1"));
      storage.writeExtractionResult(mkResult("Active 2", "Archive 2"));

      const archiveDir = storage.getArchiveDir();
      const archiveFiles = fs.readdirSync(archiveDir).filter((f) => f.endsWith(".md"));
      assert.equal(archiveFiles.length, 1, "should still have a single archive file for the month");

      const archiveContent = fs.readFileSync(
        path.join(archiveDir, archiveFiles[0]),
        "utf8"
      );
      assert.ok(archiveContent.includes("Archive 1"), "first archived content should be present");
      assert.ok(archiveContent.includes("Archive 2"), "second archived content should be present");
    });
  });

  // -------------------------------------------------------------------------
  // countLines()
  // -------------------------------------------------------------------------

  describe("countLines()", () => {
    it("delegates to countContentLines on the current memory", () => {
      storage.init();
      const content =
        "## Architecture\n- Fact 1\n- Fact 2\n<!-- comment -->\n\n";
      storage.writeMemory(content);

      const expected = countContentLines(content);
      assert.equal(storage.countLines(), expected);
    });

    it("returns 0 for blank-only content", () => {
      storage.init();
      storage.writeMemory("\n\n\n");
      assert.equal(storage.countLines(), 0);
    });

    it("excludes HTML comment lines from the count", () => {
      storage.init();
      storage.writeMemory("<!-- comment -->\n- Real fact\n");
      // Only "- Real fact" counts
      assert.equal(storage.countLines(), 1);
    });

    it("counts section headers as content lines", () => {
      storage.init();
      storage.writeMemory("## Architecture\n- Fact\n");
      assert.equal(storage.countLines(), 2);
    });
  });

  // -------------------------------------------------------------------------
  // searchArchive()
  // -------------------------------------------------------------------------

  describe("searchArchive()", () => {
    it("returns empty array when archive dir has no files", () => {
      storage.init();
      assert.deepEqual(storage.searchArchive("query"), []);
    });

    it("returns empty array for an empty query string", () => {
      storage.init();
      assert.deepEqual(storage.searchArchive(""), []);
    });

    it("returns empty array for a whitespace-only query", () => {
      storage.init();
      assert.deepEqual(storage.searchArchive("   "), []);
    });

    it("finds matching lines in the archive", () => {
      storage.init();
      const archivedContent = "- typescript module system\n- unrelated fact\n";
      storage.writeExtractionResult(
        `## Architecture\n- Active\n${ARCHIVE_SEPARATOR}\n${archivedContent}`
      );

      const results = storage.searchArchive("typescript");
      assert.ok(results.length > 0, "should find matching lines");
      assert.ok(
        results[0].matches.some((m) => m.toLowerCase().includes("typescript")),
        "matches should contain the query term"
      );
    });

    it("requires ALL terms to match (AND logic)", () => {
      storage.init();
      const archivedContent =
        "- typescript module system\n- typescript class definition\n- unrelated fact\n";
      storage.writeExtractionResult(
        `## Architecture\n- Active\n${ARCHIVE_SEPARATOR}\n${archivedContent}`
      );

      // Only "typescript class definition" contains both terms
      const results = storage.searchArchive("typescript class");
      assert.ok(results.length > 0, "should find AND matches");
      for (const result of results) {
        for (const match of result.matches) {
          assert.ok(
            match.toLowerCase().includes("typescript"),
            `match "${match}" should contain 'typescript'`
          );
          assert.ok(
            match.toLowerCase().includes("class"),
            `match "${match}" should contain 'class'`
          );
        }
      }
    });

    it("does not match lines that only have one of multiple terms", () => {
      storage.init();
      const archivedContent = "- typescript only\n- class only\n";
      storage.writeExtractionResult(
        `## Architecture\n- Active\n${ARCHIVE_SEPARATOR}\n${archivedContent}`
      );

      const results = storage.searchArchive("typescript class");
      // Neither line contains both terms
      const totalMatches = results.reduce((n, r) => n + r.matches.length, 0);
      assert.equal(totalMatches, 0, "should not return partial-term matches");
    });

    it("skips HTML comment lines in the archive", () => {
      storage.init();
      const archiveDir = storage.getArchiveDir();
      const monthStr = currentMonthStr();
      const archiveFile = path.join(archiveDir, `${monthStr}.md`);

      // Write an archive file containing a comment with the search term
      const archiveContent =
        "<!-- Archived 2026-01-01 typescript -->\n- real typescript fact\n";
      fs.writeFileSync(archiveFile, archiveContent, "utf8");

      const results = storage.searchArchive("typescript");
      assert.ok(results.length > 0, "should have results from this file");
      for (const result of results) {
        for (const match of result.matches) {
          assert.ok(
            !match.startsWith("<!--"),
            `match "${match}" should not be an HTML comment line`
          );
        }
      }
    });

    it("is case-insensitive", () => {
      storage.init();
      const archivedContent = "- TypeScript Module System\n";
      storage.writeExtractionResult(
        `## Architecture\n- Active\n${ARCHIVE_SEPARATOR}\n${archivedContent}`
      );

      const results = storage.searchArchive("typescript");
      assert.ok(results.length > 0, "search should be case-insensitive");
    });

    it("returns month label without .md extension", () => {
      storage.init();
      const archivedContent = "- match me\n";
      storage.writeExtractionResult(
        `## Architecture\n- Active\n${ARCHIVE_SEPARATOR}\n${archivedContent}`
      );

      const results = storage.searchArchive("match");
      assert.ok(results.length > 0);
      for (const r of results) {
        assert.ok(
          !r.month.endsWith(".md"),
          `month "${r.month}" should not include .md extension`
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // listArchive()
  // -------------------------------------------------------------------------

  describe("listArchive()", () => {
    it("returns empty array when archive dir has no files", () => {
      storage.init();
      assert.deepEqual(storage.listArchive(), []);
    });

    it("returns months in ascending (sorted) order", () => {
      storage.init();
      const archiveDir = storage.getArchiveDir();

      fs.writeFileSync(path.join(archiveDir, "2026-03.md"), "- fact\n", "utf8");
      fs.writeFileSync(path.join(archiveDir, "2026-01.md"), "- fact\n", "utf8");
      fs.writeFileSync(path.join(archiveDir, "2026-02.md"), "- fact\n", "utf8");

      const list = storage.listArchive();
      assert.equal(list.length, 3);
      assert.equal(list[0].month, "2026-01");
      assert.equal(list[1].month, "2026-02");
      assert.equal(list[2].month, "2026-03");
    });

    it("includes correct line counts for each month", () => {
      storage.init();
      const archiveDir = storage.getArchiveDir();

      // 2 real lines, 1 comment, 1 blank — should count as 2
      fs.writeFileSync(
        path.join(archiveDir, "2026-01.md"),
        "- fact 1\n- fact 2\n<!-- comment -->\n\n",
        "utf8"
      );

      const list = storage.listArchive();
      assert.equal(list.length, 1);
      assert.equal(list[0].month, "2026-01");
      assert.equal(list[0].lines, 2);
    });

    it("month labels do not include .md extension", () => {
      storage.init();
      const archiveDir = storage.getArchiveDir();
      fs.writeFileSync(path.join(archiveDir, "2026-05.md"), "- fact\n", "utf8");

      const list = storage.listArchive();
      assert.equal(list.length, 1);
      assert.ok(
        !list[0].month.endsWith(".md"),
        "month should not include .md extension"
      );
    });

    it("ignores non-.md files in the archive dir", () => {
      storage.init();
      const archiveDir = storage.getArchiveDir();
      fs.writeFileSync(path.join(archiveDir, "2026-01.md"), "- fact\n", "utf8");
      fs.writeFileSync(path.join(archiveDir, "README.txt"), "ignored\n", "utf8");

      const list = storage.listArchive();
      assert.equal(list.length, 1, "should only count .md files");
    });
  });
});

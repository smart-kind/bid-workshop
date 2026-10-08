import { expect, test } from "@playwright/test";
import type { BidDocument } from "../contract";
import type { LoadedBid } from "../document";
import { buildReviewBrief } from "../review";

/** T-21: the goal the workspace declares reaches the model with the brief. */

const doc: BidDocument = {
  id: "d1",
  name: "投标文件.docx",
  path: "/w/投标文件.docx",
  size: 10,
  loadedAt: 0,
  sections: [],
  blockCount: 1,
  tableCount: 0,
  charCount: 3,
};

const bid = {
  name: doc.name,
  path: doc.path,
  size: 10,
  blockCount: 1,
  tableCount: 0,
  charCount: 3,
  outline: [],
  tables: [],
  blocks: [{ index: 0, type: "paragraph", level: 0, text: "正文" }],
  text: "正文",
} as unknown as LoadedBid;

const criteria = { text: "1. 资质齐全", path: "/w/评审条件.md" };

test("carries the declared goal into the brief", () => {
  const brief = buildReviewBrief(doc, bid, criteria, 1000, "先审资质，再审报价一致性");

  expect(brief).toContain("## 本次目标（工作区档案声明）");
  expect(brief).toContain("先审资质，再审报价一致性");
  // The rest of the brief is unchanged: criteria and body are still there.
  expect(brief).toContain("## 审查条件");
  expect(brief).toContain("1. 资质齐全");
  expect(brief).toContain("## 投标文件正文");
});

test("says so when no goal was declared instead of leaving it blank", () => {
  const brief = buildReviewBrief(doc, bid, criteria, 1000);

  expect(brief).toContain("## 本次目标");
  expect(brief).toContain("工作区档案未声明目标");
});

test("carries what a previous round already raised", () => {
  const previous = [
    { id: "1", author: "审查", text: "报价与明细不符\n少了盖章页", done: true },
    { id: "2", author: "应用", text: "已采纳：确认属实", parentId: "1" },
  ];
  const brief = buildReviewBrief(doc, bid, criteria, 1000, undefined, previous);

  expect(brief).toContain("## 上一轮已经提过的");
  expect(brief).toContain("#1［已处置］审查：报价与明细不符 少了盖章页");
  expect(brief).toContain("#2［未处置］应用（回复 #1）：已采纳：确认属实");
});

test("leaves the section out when there is no previous round", () => {
  expect(buildReviewBrief(doc, bid, criteria, 1000)).not.toContain("上一轮已经提过的");
  expect(buildReviewBrief(doc, bid, criteria, 1000, "目标", [])).not.toContain("上一轮已经提过的");
});

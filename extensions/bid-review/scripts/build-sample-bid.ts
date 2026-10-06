import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildBlankDocx,
  generateTableXml,
  parseDocx,
  patchTableCellTexts,
  saveDocx,
  type SaveBlock,
} from "@genoffice/docx-engine";

/** Walk up from the working directory to the workspace root, so the script
 *  writes the same place no matter which package it is invoked from. */
function repoRoot(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("pnpm-workspace.yaml not found above " + process.cwd());
    dir = parent;
  }
}

const OUT_DIR = join(repoRoot(), "workspaces/bid-sample");
const OUT_FILE = "投标文件-某软件科技.docx";

type Blocks = SaveBlock[];

function heading(text: string, level = 1): SaveBlock {
  return { kind: "generated", block: { type: "heading", level, runs: [{ text }] } };
}

function para(text: string, opts: { bold?: boolean } = {}): SaveBlock {
  return { kind: "generated", block: { type: "paragraph", runs: [{ text, ...opts }] } };
}

function bullet(text: string): SaveBlock {
  return {
    kind: "generated",
    block: { type: "listItem", list: { kind: "bullet", numId: "1", ilvl: 0 }, runs: [{ text }] },
  };
}

function table(rows: string[][]): SaveBlock {
  const xml = generateTableXml(rows.length, rows[0].length, { headerRow: true });
  const texts = rows.map((cells) => cells.map((cell) => [cell] as [string]));
  return { kind: "xml", xml: patchTableCellTexts(xml, texts) };
}

const PROJECT = "某金融机构消费者权益保护投诉管理系统数字化改造项目";

const blocks: Blocks = [
  // ---- 封面 ----
  heading(PROJECT, 1),
  para("投  标  文  件", { bold: true }),
  para(""),
  para("投标人：某软件科技有限公司"),
  para("法定代表人：张某某"),
  para("投标日期：2026 年 10 月 5 日"),
  para(""),

  // ---- 目录 ----
  heading("目  录", 1),
  para("第一章  投标人基本情况"),
  para("第二章  资质与业绩"),
  para("第三章  技术方案"),
  para("第四章  商务报价"),
  para("第五章  服务承诺"),
  para(""),

  // ---- 第一章 ----
  heading("第一章  投标人基本情况", 1),
  heading("1.1 公司概况", 2),
  para(
    "某软件科技有限公司创办于 2018 年，注册资本为人民币 1000 万元整，" +
      "是一家致力于从事计算机软件开发及系统集成的企业，具有一定经营规模、固定办公场所和独立承担民事责任的能力。" +
      "公司目前设有总经理室、综合管理部、技术研发部、运营部、市场部等架构，项目及部门人员稳定，" +
      "具备软件开发能力和技术服务能力。公司高层管理人员皆具有二十年左右的金融行业服务经验。",
  ),
  para(
    "公司通过与各金融企事业单位的合作和多个项目的开发实施，在消费者权益保护领域积累了丰富宝贵的经验，" +
      "打造了一支长期从事消保项目研发、业务运营的专业服务团队。",
  ),
  heading("1.2 服务客户", 2),
  para(
    "我司产品已经服务了全国多个省份、直辖市，多家大中型政企客户，如某金融监管机构、某国有大型商业银行、" +
      "某股份制商业银行、某城市商业银行、某农村商业银行、某大型保险公司、某高校等，" +
      "遍布金融、政府、高校等企事业单位。",
  ),
  para(""),

  // ---- 第二章 ----
  heading("第二章  资质与业绩", 1),
  heading("2.1 资质证书", 2),
  para("我司持有以下资质与认证，证书复印件详见投标文件附件（附件一）："),
  table([
    ["序号", "证书名称", "发证/认证时间", "证书编号"],
    ["1", "营业执照", "2018 年", "详见附件"],
    ["2", "质量管理体系认证证书（ISO 9001）", "2024 年", "详见附件"],
    ["3", "环境管理体系认证证书（ISO 14001）", "2024 年", "详见附件"],
    ["4", "职业健康安全管理体系认证证书（ISO 45001）", "2024 年", "详见附件"],
  ]),
  para(""),
  heading("2.2 软件著作权", 2),
  para("2018 年至今，公司已获取软件著作权 49 项，与本项目直接相关的包括："),
  bullet("消费者权益保护投诉管理系统"),
  bullet("企业智能人机协同处理系统"),
  bullet("投诉工单标签标注平台"),
  bullet("投诉工单标签自动标注应用软件"),
  bullet("调解管理系统"),
  bullet("反欺诈系统"),
  para(""),
  heading("2.3 类似项目业绩", 2),
  para("近三年承担的同类项目情况如下："),
  table([
    ["序号", "项目名称", "委托方", "签订时间", "合同金额（元）"],
    [
      "1",
      "某数据平台系统研发技术服务（项目技术开发委托合同）",
      "某软件股份有限公司",
      "2022-12-27",
      "1,250,000",
    ],
    [
      "2",
      "某数据平台系统研发技术服务（项目技术开发委托合同）二期",
      "某软件股份有限公司",
      "2022-12-19",
      "860,000",
    ],
    ["3", "某银行支行智慧网点项目文化创意服务合同", "某文化发展基金会", "2022-05-25", "520,000"],
    ["4", "销售合同（嵌入式坐席终端等）", "某信息技术股份有限公司", "2019-12-25", "400,000"],
    [
      "5",
      "某电商信息管理系统工程建设项目-委托开发合同",
      "某科技发展有限公司",
      "2023-02-08",
      "380,000",
    ],
  ]),
  para(""),
  para("以上业绩证明材料详见附件二。"),
  para(""),

  // ---- 第三章（故意缺"项目管理计划"与"质量保证措施"） ----
  heading("第三章  技术方案", 1),
  heading("3.1 总体设计", 2),
  para(
    "本项目围绕消费者权益保护投诉的全生命周期管理展开，采用微服务架构，前端采用 Vue3，" +
      "后端采用 Spring Boot + MySQL + Redis，通过消息队列实现投诉工单的异步流转。" +
      "系统划分为投诉受理、工单流转、标签标注、统计分析、系统管理五大模块。",
  ),
  heading("3.2 投诉工单标签标注", 2),
  para(
    "标签标注模块支持人工标注与自动标注两种模式。自动标注基于历史工单语料训练分类模型，" +
      "对投诉文本进行多标签预测，人工标注结果回流用于模型迭代。标注体系支持多级标签树，" +
      "并记录标注人员、标注时间、修改历史，满足审计要求。",
  ),
  heading("3.3 数据接入与集成", 2),
  para(
    "系统提供标准 RESTful 接口与数据库直连两种接入方式，支持与现有投诉受理渠道（电话、网站、" +
      "APP、微信公众号）对接。数据传输采用 HTTPS 加密，敏感字段落库前进行脱敏处理。",
  ),
  para(""),

  // ---- 第四章：报价（故意埋入合计错误） ----
  heading("第四章  商务报价", 1),
  heading("4.1 报价明细", 2),
  table([
    ["序号", "费用项目", "内容说明", "金额（元）"],
    ["1", "软件开发费", "投诉受理、工单流转、统计分析等模块开发", "380,000"],
    ["2", "标签标注模型开发费", "分类模型训练、标注平台开发", "260,000"],
    ["3", "系统集成与部署费", "渠道对接、数据迁移、上线部署", "150,000"],
    ["4", "一年运维服务费", "上线后 12 个月技术支持与运维", "60,000"],
    ["", "合计", "", "800,000"],
  ]),
  para("说明：以上报价为含税总价，税率 6%。明细合计与总价一致。"),
  para(""),
  heading("4.2 报价有效期", 2),
  para("本报价自投标截止之日起 90 日内有效。"),
  para(""),

  // ---- 第五章 ----
  heading("第五章  服务承诺", 1),
  bullet("系统上线后提供 12 个月免费质保，质保期内 7×24 小时响应。"),
  bullet("一般问题 4 小时内响应，严重问题 2 小时内响应并给出处理方案。"),
  bullet("质保期内提供不少于 4 次现场巡检与系统优化。"),
  bullet("为甲方运维人员提供不少于 5 人次的免费培训。"),
  para(""),
  para("承诺工期：自合同签订之日起 195 日历天内完成全部建设内容并通过验收。"),
  para(""),
  para(""),
  // ---- 故意留空的签章（埋入"缺少签章"问题） ----
  para("投标人（盖章）："),
  para(""),
  para("法定代表人或授权代表（签字）："),
  para(""),
  para("日    期：      年      月      日"),
];

async function main() {
  const parsed = await parseDocx(await buildBlankDocx({ eastAsiaFont: "SimSun" }));
  const bytes = await saveDocx(parsed, blocks);

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, OUT_FILE);
  writeFileSync(outPath, bytes);
  console.log(`wrote ${outPath} (${bytes.byteLength} bytes)`);

  const check = await parseDocx(bytes);
  console.log("blocks:", check.blocks.length);
  const headings = check.blocks.filter((b) => b.type === "heading").length;
  const tables = check.blocks.filter((b) => b.type === "table").length;
  console.log("headings:", headings, "| tables:", tables);
  console.log(
    "first 3 block types:",
    check.blocks
      .slice(0, 3)
      .map((b) => b.type)
      .join(", "),
  );
}

main().catch((error) => {
  console.error("ERROR", error);
  process.exitCode = 1;
});

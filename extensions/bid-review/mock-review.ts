import type { BidIssue } from "./contract";

export function generateMockIssues(): BidIssue[] {
  return [
    {
      id: "issue-1",
      severity: "critical",
      category: "qualification",
      title: "项目经理资质不符",
      description:
        "招标要求项目经理须具备二级建造师及以上资格，但投标文件中张三持有的是一级建造师证书，虽然资质高于要求，但注册专业需核实是否为市政公用工程方向。",
      location: { section: "第二章 投标人资格要求", page: 5 },
      suggestion: "核实项目经理注册专业是否与招标要求一致，确认注册证书在有效期内。",
    },
    {
      id: "issue-2",
      severity: "critical",
      category: "technical",
      title: "工期超出招标要求",
      description:
        "投标文件计划工期为195日历天，超出招标文件要求的180日历天，超出15天（8.3%），构成实质性偏差。",
      location: { section: "第三章 评标办法", page: 12 },
      suggestion:
        "需与投标方确认是否可调整工期至180天以内，否则可能构成废标条件。建议组织澄清会要求书面确认。",
    },
    {
      id: "issue-3",
      severity: "warning",
      category: "pricing",
      title: "沥青混凝土单价偏低",
      description:
        "沥青混凝土面层报价95元/m²，参考同期市场信息价约110-120元/m²，偏差约15-20%，存在低于成本报价的风险。根据评标办法，低于最高投标限价85%须进行成本合理性说明。",
      location: { section: "第五章 工程量清单", page: 28 },
      suggestion: "要求投标方提供单价分析表及成本合理性说明，重点核实沥青采购渠道和价格依据。",
    },
    {
      id: "issue-4",
      severity: "warning",
      category: "legal",
      title: "商务条款存在多项偏差",
      description:
        "投标方提出4项商务偏差：①材料调价门槛±3%（招标±5%）②违约金上限3%（招标5%）③质保金2%（招标3%）④工期195天（招标180天）。偏差项较多，可能影响合同执行。",
      location: { section: "第四章 合同条款", page: 18 },
      suggestion:
        "建议逐条评估偏差影响：材料调价偏差有利于招标人可接受；违约金和质保金偏差需评估风险敞口；工期偏差为关键项，需优先解决。",
    },
    {
      id: "issue-5",
      severity: "info",
      category: "format",
      title: "业绩证明材料不完整",
      description:
        "投标文件提供了2项类似工程业绩，但仅列出项目名称、年份和金额，未附中标通知书或合同复印件等证明材料。",
      location: { section: "第二章 投标人资格要求", page: 7 },
      suggestion: "要求补充提供业绩证明材料原件扫描件，包括但不限于中标通知书、合同协议书、竣工验收报告。",
    },
    {
      id: "issue-6",
      severity: "info",
      category: "technical",
      title: "施工组织方案缺少夜间施工措施",
      description:
        "技术方案提到'夜间施工需另行审批'，但未提供夜间施工方案的具体措施，包括交通疏导、噪音控制、照明方案等。",
      location: { section: "第六章 技术规范", page: 35 },
      suggestion: "要求补充夜间施工专项方案，明确交通疏导方案、降噪措施、安全保证措施和应急预案。",
    },
    {
      id: "issue-7",
      severity: "warning",
      category: "pricing",
      title: "HDPE排水管单价偏高",
      description:
        "HDPE排水管DN600报价280元/m，参考同期市场信息价约220-250元/m，偏高约12-27%，且工程量3200m金额较大（合计89.6万元）。",
      location: { section: "第五章 工程量清单", page: 30 },
      suggestion: "要求提供管材采购合同或厂家报价函，核实单价合理性。可考虑暂估价或甲供材方式控制成本。",
    },
    {
      id: "issue-8",
      severity: "info",
      category: "legal",
      title: "投标有效期未明确说明",
      description: "投标文件中未明确承诺投标有效期，按惯例应为开标后90日历天。",
      location: { section: "第一章 招标公告", page: 3 },
      suggestion: "澄清时要求投标方书面确认投标有效期不少于90日历天。",
    },
  ];
}

export function generateMockSummary(): string {
  return `## 审查摘要

**项目**：某市政道路改造工程（GC-2026-0458）
**投标方**：某建设集团有限公司
**投标金额**：1,150万元（最高限价1,280万元，下浮10.2%）

### 问题统计
- 🔴 严重问题：2项（工期超出、资质待核实）
- 🟡 警告：3项（单价异常、商务偏差、管材偏高）
- 🔵 提示：3项（材料不完整、方案缺失、有效期未确认）

### 总体评估
投标文件存在1项实质性偏差（工期超出），需优先处理。商务条款偏差较多但多有利于招标人。技术方案深度不足，建议组织澄清会要求补充。综合建议：待澄清后进入详细评审。

> ⚠️ 以上为演示数据，用于验证审查流程。实际审查需接入 AI Agent + genoffice 文档引擎。`;
}

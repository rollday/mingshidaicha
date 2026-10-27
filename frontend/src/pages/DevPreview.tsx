import { useState } from "react";
import {
  AccordionCard,
  Button,
  Card,
  Field,
  Segmented,
  Table,
  Tag,
  fieldInputClass,
  type Column,
} from "../components/base";

const columns: Column[] = [
  { key: "item", label: "项目" },
  { key: "amount", label: "金额", align: "right" },
  { key: "payee", label: "收取主体" },
  { key: "inTable", label: "在明示表内" },
];

const rows = [
  { item: "贷款利息", amount: "661.88 元", payee: "某贷款机构", inTable: <Tag tone="green">在</Tag> },
  { item: "担保费", amount: "1,440.00 元", payee: "某融资担保公司", inTable: <Tag tone="amber">列了，没算</Tag> },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

export default function DevPreview() {
  const [mode, setMode] = useState<"general" | "student">("general");
  const [open, setOpen] = useState(true);
  const [fee, setFee] = useState("50");

  return (
    <main className="mx-auto flex max-w-page flex-col gap-6 px-gutter py-7">
      <header className="flex flex-col gap-1">
        <h1 className="text-display font-serif font-bold">基础件预览</h1>
        <p className="text-sm text-mute">
          用于右侧比对：Card / Button / Segmented / Tag / Field / Table 的全部变体。
        </p>
        <p className="text-2xs text-mute">
          13px 档（text-2xs）用于密集表格与注释——这一行就是在验证它。
        </p>
      </header>

      <Section title="Card">
        <div className="grid gap-6 sm:grid-cols-2">
          <Card padding="md">
            <p className="text-sm text-mute">padding=md（p-6，24）</p>
          </Card>
          <Card padding="lg">
            <p className="text-sm text-mute">padding=lg（p-7，28）</p>
          </Card>
          <Card padding="wide">
            <p className="text-sm text-mute">padding=wide（px-7 py-6）</p>
          </Card>
          <Card padding="none" className="p-0">
            <p className="p-6 text-sm text-mute">padding=none，自管内边距</p>
          </Card>
        </div>

        <Card>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-mute">inset 三种 tone</p>
            <Card inset>中性嵌套框（条款引文）</Card>
            <Card inset tone="amber">
              琥珀提示框（原文条款高亮）
            </Card>
            <Card inset tone="red">
              标红行（核验对不上）
            </Card>
          </div>
        </Card>
      </Section>

      <Section title="Button">
        <Card>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="primary">生成报告</Button>
            <Button variant="secondary">重新选择</Button>
            <Button variant="chip">通用</Button>
            <Button variant="chip" pressed>
              大学生
            </Button>
            <Button variant="text">内部收益率</Button>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button variant="primary" disabled>
              生成报告
            </Button>
            <Button variant="secondary" disabled>
              重新选择
            </Button>
            <Button variant="primary" loading>
              核验中…
            </Button>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Button variant="sample">
              <span className="text-xs text-mute">S2</span>
              <span className="text-base font-medium">明示表外另收服务费</span>
              <span className="text-sm text-mute">合同里多出每期 50 元，明示表没列</span>
            </Button>
            <Button variant="sample">
              <span className="text-xs text-mute">S3</span>
              <span className="text-base font-medium">担保费没算进年化</span>
              <span className="text-sm text-mute">表内标注 12%，重算 36.77%</span>
            </Button>
          </div>
        </Card>
      </Section>

      <Section title="Segmented">
        <Card>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "general", label: "通用" },
              { value: "student", label: "大学生" },
            ]}
          />
        </Card>
      </Section>

      <Section title="Tag">
        <Card>
          <div className="flex flex-wrap gap-3">
            <Tag tone="red">高风险</Tag>
            <Tag tone="amber">需核实</Tag>
            <Tag tone="green">一致</Tag>
            <Tag tone="blue">有记录</Tag>
            <Tag tone="neutral">把握高</Tag>
            <Tag tone="low">把握低</Tag>
          </div>
        </Card>
      </Section>

      <Section title="Field">
        <Card>
          <div className="grid max-w-80 gap-4">
            <Field suffix="元">
              <input
                className={fieldInputClass}
                inputMode="decimal"
                value={fee}
                onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, ""))}
              />
            </Field>
            <Field>
              <input className={fieldInputClass} placeholder="每月可支配收入" />
            </Field>
          </div>
        </Card>
      </Section>

      <Section title="Table">
        <Card padding="wide" overflowX>
          <h3 className="mb-3 text-lg font-medium">plain · 费用明细</h3>
          <div className="min-w-105">
            <Table label="费用明细" columns={columns} rows={rows} />
          </div>
        </Card>

        <Card padding="wide">
          <h3 className="mb-3 text-lg font-medium">kv · 读到的字段</h3>
          <Table
            variant="kv"
            rows={[
              { label: "贷款本金", value: "10,000 元" },
              { label: "期数与方式", value: "12 期，等额本息" },
              { label: "表内标注年化", value: "12.00%" },
            ]}
          />
        </Card>

        <Card padding="wide">
          <h3 className="mb-3 text-lg font-medium">findings · 放贷方核验</h3>
          <Table
            variant="findings"
            label="放贷方核验"
            rows={[
              { source: "持牌名单", result: "查到该机构", status: "有记录", tone: "blue" },
              { source: "主体类型", result: "农村商业银行", status: "一致", tone: "green" },
              { source: "R06", result: "小贷公司 + 在校生", status: "对应明文", tone: "red" },
            ]}
          />
        </Card>

        <Card>
          <h3 className="mb-3 text-lg font-medium">source · 原文表</h3>
          <Table
            variant="source"
            label="个人贷款综合融资成本明示表"
            rows={[
              { label: "贷款本金金额", value: "10,000 元" },
              { label: "贷款利息 · 等额本息 12 期", value: "12.00%" },
              { label: "收取主体 / 违约或有成本", value: "空白 / 未列出", muted: true },
            ]}
          />
        </Card>
      </Section>

      <Section title="AccordionCard">
        <AccordionCard title="合规预警 · 2 项" open={open} onToggle={() => setOpen(!open)}>
          <p className="text-sm text-mute">
            展开内容按 04 的状态规范排版；箭头随 open 旋转，体使用 unfold 动画。
          </p>
        </AccordionCard>
      </Section>

      <p className="pb-10 text-xs text-mute">
        本页仅用于开发期比对，不进入最终交付。
      </p>
    </main>
  );
}

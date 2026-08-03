import type { ReactElement, ReactNode } from "react";
import "./brand.css";
import type { LinkedInImageSpec, LinkedInLayout } from "../../../../content/linkedin/schema";

/* Spec2 3.4. Five templates, each a pure function of the spec, each rendering
   at exactly 1080 by 1350.

   No DigitalGabry token appears in this file or in brand.css, and nothing from
   brand.css appears anywhere else. Invariant 12: two design systems with
   different jobs, and mixing them would put brand orange on a calendar block
   or drift a generated image toward the app's greys. */

const BRAND_MARK = "FlashFX";

function Eyebrow({ text }: { text: string | undefined }) {
  return text === undefined || text === "" ? null : (
    <div className="fx-eyebrow">{text}</div>
  );
}

function Badge({ text }: { text: string | undefined }) {
  return text === undefined || text === "" ? null : (
    <div className="fx-badge">{text}</div>
  );
}

function Mark() {
  return (
    <div className="fx-mark">
      <span className="fx-mark-rule" />
      {BRAND_MARK}
    </div>
  );
}

function CodeBlock({ snippet }: { snippet: NonNullable<LinkedInImageSpec["codeSnippet"]> }) {
  return (
    <div className="fx-code">
      <div className="fx-code-bar">
        <span className="fx-code-dot" />
        <span className="fx-code-dot" />
        <span className="fx-code-dot" />
        <span className="fx-code-lang">{snippet.language}</span>
      </div>
      <div className="fx-code-body">{snippet.lines.join("\n")}</div>
    </div>
  );
}

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="fx-bullets">
      {items.map((item, index) => (
        <li key={index} className="fx-bullet">
          <span className="fx-bullet-dot" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export type TemplateProps = { spec: LinkedInImageSpec };

function Shell({ spec, children }: TemplateProps & { children: ReactNode }) {
  return (
    <div className={`fx-root fx-accent-${spec.accent}`}>
      <div className="fx-stack">{children}</div>
      <Mark />
    </div>
  );
}

function Headline({ spec }: TemplateProps) {
  return (
    <Shell spec={spec}>
      <Eyebrow text={spec.eyebrow} />
      <div className="fx-headline">{spec.headline}</div>
      {spec.subheadline !== undefined && <div className="fx-sub">{spec.subheadline}</div>}
      <Badge text={spec.badge} />
    </Shell>
  );
}

function HeadlineBullets({ spec }: TemplateProps) {
  return (
    <Shell spec={spec}>
      <Eyebrow text={spec.eyebrow} />
      <div className="fx-headline">{spec.headline}</div>
      {(spec.bullets?.length ?? 0) > 0 && <Bullets items={spec.bullets ?? []} />}
    </Shell>
  );
}

function Code({ spec }: TemplateProps) {
  return (
    <Shell spec={spec}>
      <Eyebrow text={spec.eyebrow} />
      <div className="fx-headline">{spec.headline}</div>
      {spec.codeSnippet !== undefined ? (
        <CodeBlock snippet={spec.codeSnippet} />
      ) : (
        spec.subheadline !== undefined && <div className="fx-sub">{spec.subheadline}</div>
      )}
    </Shell>
  );
}

function Metric({ spec }: TemplateProps) {
  return (
    <Shell spec={spec}>
      <Eyebrow text={spec.eyebrow} />
      <div className="fx-headline">{spec.headline}</div>
      {spec.metric !== undefined && (
        <div>
          <div className="fx-metric">{spec.metric.value}</div>
          <div className="fx-metric-label">{spec.metric.label}</div>
        </div>
      )}
    </Shell>
  );
}

function Split({ spec }: TemplateProps) {
  return (
    <Shell spec={spec}>
      <Eyebrow text={spec.eyebrow} />
      <div className="fx-split">
        <div className="fx-split-left">
          <div className="fx-headline">{spec.headline}</div>
          {spec.subheadline !== undefined && (
            <div className="fx-sub" style={{ marginTop: "32px" }}>
              {spec.subheadline}
            </div>
          )}
        </div>
        <div className="fx-split-right">
          {spec.codeSnippet !== undefined ? (
            <CodeBlock snippet={spec.codeSnippet} />
          ) : (
            <Bullets items={spec.bullets ?? []} />
          )}
        </div>
      </div>
    </Shell>
  );
}

export const TEMPLATES: Record<
  LinkedInLayout,
  (props: TemplateProps) => ReactElement
> = {
  headline: Headline,
  "headline-bullets": HeadlineBullets,
  code: Code,
  metric: Metric,
  split: Split,
};

export const TEMPLATE_LABELS: Record<LinkedInLayout, string> = {
  headline: "Headline",
  "headline-bullets": "Headline and bullets",
  code: "Code",
  metric: "Metric",
  split: "Split",
};

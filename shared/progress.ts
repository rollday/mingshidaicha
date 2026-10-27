/** Public processing evidence, never private model reasoning or raw prompts. */
export type Activity = {
  id:string; timestamp:string; revision:number|null;
  stage:string; kind:'process'|'analysis'; status:'started'|'completed'|'warning'; message:string;
  document_id?:string; page?:number; total_pages?:number;
  evidence_ids?:string[]; rule_ids?:string[]; url?:string;
};
export type DraftSection = {id:string;kind:'summary'|'finding'|'action'|'limitation';text:string;rule_id?:string|null};
export type ReportDraft = {
  attempt:number; status:'streaming'|'validating'|'retrying'|'discarded'|'accepted'; sections:DraftSection[];
};

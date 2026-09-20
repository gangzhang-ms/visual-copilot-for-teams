import type { AudiencePreview } from "../shared/types";
import type { AnalysisSession } from "./analysis-session";
import { GraphContext, targetBase } from "./graph-context";
import { requireVisual } from "./visual-errors";
export async function loadAudience(graph: GraphContext, session: AnalysisSession, consent: boolean): Promise<AudiencePreview> {
  const result = await graph.read(session, `${targetBase(session.binding.target)}/members`, consent);
  requireVisual(Array.isArray(result.value), "target-unavailable");
  return { members: result.value.slice(0, 50).map((m: any, i: number) => ({
    label: `Participant ${i + 1}`, display: typeof m.displayName === "string" ? m.displayName.slice(0, 100) : "Unknown"
  })), partial: result.value.length > 50 || !!result["@odata.nextLink"], retrievedAt: Date.now() };
}

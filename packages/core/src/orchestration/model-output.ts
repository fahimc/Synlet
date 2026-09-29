import { DomainError } from "../domain/types.js";
import type { ModelPort, ModelRequest } from "../ports/index.js";

/** A parseable prefix is NOT a completed decision. Never execute it. */
export async function collectModelOutput(model: ModelPort, request: ModelRequest, signal: AbortSignal): Promise<string> {
  let text = "";
  let completed = false;
  for await (const event of model.generate(request, signal)) {
    signal.throwIfAborted();
    if (completed) throw new DomainError("INVALID_OUTPUT", "Data after model completion");
    if (event.type === "error") throw new DomainError("INVALID_OUTPUT", event.message);
    if (event.type === "text_delta") {
      text += event.text;
      if (text.length > 4 * 1024 * 1024) throw new DomainError("RESOURCE_EXHAUSTED", "Model response exceeds transport limit");
    }
    if (event.type === "tool_proposal") throw new DomainError("INVALID_OUTPUT", "Unexpected native tool proposal on the structured-decision channel");
    if (event.type === "done") {
      if (event.finish !== "stop") throw new DomainError("INVALID_OUTPUT", `Incomplete generation: ${event.finish}`);
      completed = true;
    }
  }
  if (!completed || !text.trim()) throw new DomainError("INVALID_OUTPUT", "Model stream ended without a complete response");
  return text.trim();
}

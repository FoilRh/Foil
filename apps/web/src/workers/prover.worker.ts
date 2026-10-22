/// <reference lib="webworker" />
// Groth16 proving off the main thread (Build §2: on-device proving, no remote prover).
import { loadCircuit, prove } from "@foil/client";

type Job = { id: number; name: "joinsplit" | "tin_request"; input: Record<string, unknown> };

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, name, input } = e.data;
  try {
    const { wasm, zkey } = await loadCircuit(name);
    const { proof } = await prove(input, wasm, zkey);
    self.postMessage({ id, proof });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : "proof failed" });
  }
};

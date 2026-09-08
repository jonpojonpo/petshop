import type { Pet, Quest, Receipt } from "./types.ts";

/** Explicit selection remains explicit. Auto routing spends only local tokens. */
export function routeLocal(
  pets: Pet[],
  ledger: Receipt[],
  quest: Pick<Quest, "taskType" | "difficulty" | "requiredEquipment">,
  busy: ReadonlySet<string>,
) {
  const needsWrite = ["implementation", "shell"].includes(quest.taskType || "implementation");
  const eligible = pets.filter(p =>
    p.petshop.billing === "local" && !busy.has(p.id) &&
    (!needsWrite || p.sandbox_mode !== "read-only") &&
    (quest.requiredEquipment || []).every(tool => p.petshop.equipment.includes(tool))
  );
  const experience = (p: Pet) => ledger.filter(r =>
    r.petId === p.id && r.fingerprint === p.fingerprint &&
    r.taskType === (quest.taskType || "implementation") && r.checkPassed
  ).reduce((sum,r) => sum + r.xp, 0);
  eligible.sort((a,b) => experience(b)-experience(a) ||
    (quest.difficulty === "complex" ? (b.model_context_window || 0)-(a.model_context_window || 0) : 0) ||
    Number(b.petshop.role === "conductor")-Number(a.petshop.role === "conductor") ||
    (b.observedTps || 0)-(a.observedTps || 0) || a.id.localeCompare(b.id));
  if (!eligible.length) throw new Error("No idle local pet matches this quest’s equipment and access. Equip a local companion or select a pet explicitly.");
  const pet=eligible[0];
  return {pet, reason:`Local routing selected ${pet.name}: ${experience(pet)} verified ${quest.taskType || "implementation"} quests, matching equipment, ${pet.sandbox_mode} access.`};
}

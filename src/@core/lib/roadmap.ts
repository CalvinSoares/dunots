import type { Flashcard, QuizAttempt } from "../types";

import type {
  StudyRoadmapLink,
  StudyRoadmapNode,
  StudyRoadmapNodeProgress,
  StudyRoadmapProgress,
  StudyRoadmapPriority,
} from "../types/roadmap";

export const ROADMAP_PRIORITY_OPTIONS: Array<{ id: StudyRoadmapPriority; label: string; description: string }> = [
  { id: "none", label: "sem prioridade", description: "Ordem manual da trilha" },
  { id: "low", label: "baixa", description: "Pode aguardar" },
  { id: "medium", label: "média", description: "Importante para a revisão" },
  { id: "high", label: "alta", description: "Prioridade de estudo" },
  { id: "urgent", label: "urgente", description: "Estudar primeiro" },
];

export function getRoadmapPriorityWeight(priority?: StudyRoadmapPriority) {
  return priority === "urgent" ? 4 : priority === "high" ? 3 : priority === "medium" ? 2 : priority === "low" ? 1 : 0;
}

export function buildRoadmapChildren(nodes: StudyRoadmapNode[]) {
  const children = new Map<string | undefined, StudyRoadmapNode[]>();

  for (const node of nodes) {
    const group = children.get(node.parentId) ?? [];
    group.push(node);
    children.set(node.parentId, group);
  }

  for (const group of children.values()) {
    group.sort((left, right) => getRoadmapPriorityWeight(right.priority) - getRoadmapPriorityWeight(left.priority) || left.order - right.order || left.title.localeCompare(right.title));
  }

  return children;
}

export function getRoadmapDescendantNodes(nodeId: string, nodes: StudyRoadmapNode[]) {
  const children = buildRoadmapChildren(nodes);
  const result: StudyRoadmapNode[] = [];
  const pending = [...(children.get(nodeId) ?? [])];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) continue;
    result.push(current);
    pending.push(...(children.get(current.id) ?? []));
  }

  return result;
}

export function getRoadmapLeafNodes(nodes: StudyRoadmapNode[]) {
  const parentIds = new Set(nodes.flatMap((node) => (node.parentId ? [node.parentId] : [])));
  return nodes.filter((node) => !parentIds.has(node.id));
}

export function getRoadmapNodeProgress(nodes: StudyRoadmapNode[]): StudyRoadmapNodeProgress {
  const leaves = getRoadmapLeafNodes(nodes);
  const completed = leaves.filter((node) => node.completed).length;
  const total = leaves.length;

  return {
    total,
    completed,
    percentage: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export function getRoadmapProgress(roadmapId: string, nodes: StudyRoadmapNode[]): StudyRoadmapProgress {
  return { roadmapId, ...getRoadmapNodeProgress(nodes) };
}

export function setRoadmapNodeCompletion(
  nodeId: string,
  completed: boolean,
  nodes: StudyRoadmapNode[],
  now = new Date().toISOString(),
) {
  const target = nodes.find((node) => node.id === nodeId);
  if (!target) return nodes;

  const affectedIds = new Set([nodeId, ...getRoadmapDescendantNodes(nodeId, nodes).map((node) => node.id)]);
  return nodes.map((node) =>
    affectedIds.has(node.id)
      ? { ...node, completed, completedAt: completed ? now : undefined, updatedAt: now }
      : node,
  );
}

export function moveRoadmapNode(nodeId: string, direction: "up" | "down", nodes: StudyRoadmapNode[], now = new Date().toISOString()) {
  const target = nodes.find((node) => node.id === nodeId);
  if (!target) return nodes;

  const siblings = nodes
    .filter((node) => node.roadmapId === target.roadmapId && node.parentId === target.parentId && getRoadmapPriorityWeight(node.priority) === getRoadmapPriorityWeight(target.priority))
    .sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const index = siblings.findIndex((node) => node.id === nodeId);
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= siblings.length) return nodes;

  const reordered = [...siblings];
  [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
  const orderById = new Map(reordered.map((node, order) => [node.id, order]));

  return nodes.map((node) => {
    const order = orderById.get(node.id);
    return order === undefined
      ? node
      : { ...node, order, updatedAt: now };
  });
}
export function getRoadmapNodeAncestors(nodeId: string, nodes: StudyRoadmapNode[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ancestors: StudyRoadmapNode[] = [];
  let current = byId.get(nodeId);

  while (current?.parentId) {
    current = byId.get(current.parentId);
    if (current) ancestors.push(current);
  }

  return ancestors;
}

export interface RoadmapImportItem {
  title: string;
  depth: number;
  description?: string;
}

export function parseRoadmapImportText(text: string): RoadmapImportItem[] {
  const normalizedText = text
    .replace(/\u00a0/g, " ")
    .replace(/&#x20;|&nbsp;/gi, " ")
    .replace(/\\\s*(?=\S)/g, "\n");
  const rawLines = normalizedText.split(/\r?\n/);
  const hasParts = rawLines.some((line) => /^\s*PARTE\s+\d+/i.test(line));
  let hasSection = false;
  let inCodeBlock = false;
  let codeLines: string[] = [];
  const items: RoadmapImportItem[] = [];
  const codeFence = String.fromCharCode(96).repeat(3);

  const appendCodeToLastItem = (code: string) => {
    if (!code || items.length === 0) return;
    const last = items[items.length - 1];
    const description = [last.description, code].filter(Boolean).join(" ").trim();
    items[items.length - 1] = description ? { ...last, description } : last;
  };

  for (const raw of rawLines) {
    const trimmedRaw = raw.trim();
    if (trimmedRaw.startsWith(codeFence)) {
      if (inCodeBlock) appendCodeToLastItem(codeLines.join(" ").trim());
      inCodeBlock = !inCodeBlock;
      codeLines = [];
      continue;
    }
    if (inCodeBlock) {
      if (trimmedRaw) codeLines.push(trimmedRaw);
      continue;
    }

    const indentation = raw.match(/^\s*/)?.[0] ?? "";
    const content = raw.replace(/^\s*[-*•]\s*/, "").replace(/^#+\s*/, "").replace(/\\\s*$/, "").trim();
    if (!content) continue;

    const [titlePart, ...descriptionParts] = content.split("|");
    const title = titlePart.trim();
    const description = descriptionParts.join("|").trim() || undefined;
    const isFormattingOnly = /^[~|\\↔→←—–_.\s-]+$/.test(title);
    const isStandaloneFormula = /^[Nn\d\s()+−*/.,=<>≤≥_^|\\-]+$/.test(title) && /[+\-−*/=]/.test(title);
    if (!title || isFormattingOnly || isStandaloneFormula) continue;

    const isPart = /^PARTE\s+\d+/i.test(title);
    const isNumberedSection = /^\d+\.\s+/.test(title);
    if (isNumberedSection) hasSection = true;
    const inferredDepth = isPart ? 0 : isNumberedSection ? (hasParts ? 2 : 0) : hasSection ? (hasParts ? 4 : 2) : 0;
    const depth = Math.max(inferredDepth, indentation.replace(/\t/g, "  ").length);
    items.push(description ? { title, description, depth } : { title, depth });
  }

  if (inCodeBlock) appendCodeToLastItem(codeLines.join(" ").trim());
  return items;
}

export function formatRoadmapImportText(nodes: StudyRoadmapNode[]) {
  const children = buildRoadmapChildren(nodes);
  const visited = new Set<string>();
  const lines: string[] = [];

  const visit = (parentId: string | undefined, depth: number) => {
    for (const node of children.get(parentId) ?? []) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      const title = node.title.trim();
      if (!title) continue;
      const description = node.description?.replace(/\s+/g, " ").trim();
      lines.push(`${"  ".repeat(depth)}${title}${description ? ` | ${description}` : ""}`);
      visit(node.id, depth + 1);
    }
  };

  visit(undefined, 0);

  // Preserva nós órfãos caso uma importação antiga tenha perdido o pai.
  for (const node of nodes) {
    if (visited.has(node.id) || !node.title.trim()) continue;
    const description = node.description?.replace(/\s+/g, " ").trim();
    lines.push(`${node.title.trim()}${description ? ` | ${description}` : ""}`);
  }

  return lines.join("\n");
}

export interface RoadmapMaterialProgress {
  total: number;
  completed: number;
  percentage: number;
  flashcardsTotal: number;
  flashcardsCompleted: number;
  questionsTotal: number;
  questionsAnswered: number;
}

export function getRoadmapMaterialProgress(links: StudyRoadmapLink[], cards: Flashcard[], attempts: QuizAttempt[], nodeIds?: string[]): RoadmapMaterialProgress {
  const scopedNodeIds = nodeIds ? new Set(nodeIds) : null;
  const unique = new Map<string, StudyRoadmapLink>();
  links.filter((link) => !scopedNodeIds || scopedNodeIds.has(link.nodeId)).forEach((link) => unique.set(link.resourceType + ":" + link.resourceId, link));
  const cardMap = new Map(cards.map((card) => [card.id, card]));
  const flashcardLinks = Array.from(unique.values()).filter((link) => link.resourceType === "flashcard");
  const questionLinks = Array.from(unique.values()).filter((link) => link.resourceType === "quiz-question");
  const flashcardsCompleted = flashcardLinks.filter((link) => {
    const card = cardMap.get(link.resourceId);
    return Boolean(card && (card.repetitions > 0 || card.lastReviewAt));
  }).length;
  const questionsAnswered = questionLinks.filter((link) => attempts.some((attempt) => Object.prototype.hasOwnProperty.call(attempt.answers, link.resourceId))).length;
  const total = flashcardLinks.length + questionLinks.length;
  const completed = flashcardsCompleted + questionsAnswered;
  return { total, completed, percentage: total ? Math.round((completed / total) * 100) : 0, flashcardsTotal: flashcardLinks.length, flashcardsCompleted, questionsTotal: questionLinks.length, questionsAnswered };
}

export function normalizeRoadmapLinks<T extends { resourceType: string; resourceId: string }>(links: T[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = link.resourceType + ":" + link.resourceId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

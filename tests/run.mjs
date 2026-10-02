import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

const server = await createServer({
  configFile: "./vite.config.ts",
  server: { middlewareMode: true },
  logLevel: "error",
});

try {
  const quiz = await server.ssrLoadModule("/src/@core/lib/quiz.ts");
  const pdf = await server.ssrLoadModule("/src/@core/lib/pdf.ts");
  const roadmap = await server.ssrLoadModule("/src/@core/lib/roadmap.ts");
  const modals = await server.ssrLoadModule("/src/components/features/quiz/QuizModals.tsx");
  const sync = await server.ssrLoadModule("/src/@core/lib/sync.ts");
  const question = (id, topic = "redes") => ({ id, examId: "exam-1", statement: "enunciado", options: [{ id: "A", text: "sim" }, { id: "B", text: "não" }], correctOption: "A", subject: "TI", topic, createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  const syncPackage = sync.parseSyncPackage({ format: "dunots-sync", version: 1, exportedAt: "2026-09-22T00:00:00.000Z", source: { deviceId: "other", deviceName: "Outro notebook" }, collections: { flashcards: [{ id: "fc-1", updatedAt: "2026-09-22T00:00:00.000Z" }], quiz_questions: [{ id: "q-1", updatedAt: "2026-09-22T00:00:00.000Z" }], quiz_exams: [], leetcode_problems: [], articles: [], snippets: [], study_phases: [], diagrams: [], quiz_attempts: [], study_roadmaps: [], roadmap_nodes: [], roadmap_links: [] } });
  const syncPreview = sync.previewSyncPackage({ flashcards: [], quiz_questions: [{ id: "q-1", updatedAt: "2026-09-21T00:00:00.000Z" }], quiz_exams: [], leetcode_problems: [], challenge_reviews: [], articles: [], snippets: [], study_phases: [], diagrams: [], quiz_attempts: [], study_roadmaps: [], roadmap_nodes: [], roadmap_links: [], sync_tombstones: [] }, syncPackage);
  assert.equal(syncPreview.added, 1);
  assert.equal(syncPreview.updated, 1);

  const desktopFixture = JSON.parse(await readFile("mobile/test/fixtures/desktop_sync_v1.dunots.json", "utf8"));
  const parsedDesktopFixture = sync.parseSyncPackage(desktopFixture);
  assert.equal(parsedDesktopFixture.source.deviceName, "Dunots Desktop");
  assert.equal(parsedDesktopFixture.collections.quiz_questions[0].correctOption, "B");
  assert.equal(parsedDesktopFixture.collections.diagrams[0].nodes[0].data.label, "Switch");

  const mobileFixture = JSON.parse(await readFile("mobile/test/fixtures/mobile_sync_v1.dunots.json", "utf8"));
  const parsedMobileFixture = sync.parseSyncPackage(mobileFixture);
  assert.equal(parsedMobileFixture.source.deviceName, "Dunots Mobile");
  assert.equal(parsedMobileFixture.collections.study_roadmaps[0].updatedAt, "2026-10-01T12:00:00.000Z");
  assert.equal(parsedMobileFixture.collections.roadmap_links[0].id, "mobile-node-1:mobile-card-1:flashcard");
  const desktopWebCryptoEnvelope = await readFile("mobile/test/fixtures/desktop_webcrypto_envelope.json", "utf8");
  const decryptedDesktopPayload = await sync.decryptSyncPayload(desktopWebCryptoEnvelope, "pairing-token");
  assert.equal(decryptedDesktopPayload.source.deviceId, "mobile-test");
  const pairingInvite = sync.parsePairingInvite({
    format: "dunots-pairing",
    version: 1,
    address: "http://127.0.0.1:43127",
    token: "pairing-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  assert.equal(pairingInvite.address, "http://127.0.0.1:43127");
  assert.equal(sync.parsePairingInvite({
    address: "http://127.0.0.1:43127",
    token: "legacy-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
  }).token, "legacy-token");

  assert.equal(quiz.getAttemptStatus({ status: "completed" }), "completed");
  assert.equal(quiz.getAttemptStatus({ finishedAt: "2026-01-01" }), "completed");
  assert.equal(quiz.getAttemptStatus({}), "in-progress");

  const attempt = { questionIds: ["q1", "q2", "q3"], answers: { q1: "A" }, currentQuestionIndex: 2 };
  assert.equal(quiz.getResumeQuestionIndex(attempt), 2);
  assert.equal(quiz.getResumeQuestionIndex({ ...attempt, currentQuestionIndex: undefined }), 1);
  assert.deepEqual(quiz.getAttemptMetrics({ ...attempt, correctCount: 1 }), { total: 3, answered: 1, unanswered: 2, correct: 1, wrong: 0, rate: 33 });
  assert.equal(quiz.calculateAttemptCorrectCount(attempt, [question("q1"), question("q2")]), 1);

  const quickQuestion = modals.parseQuickQuestionText("Enunciado de teste.\n(A) 254\n(B) 510\n(C) 512\n(D) 1.022\n(E) 2.046");
  assert.equal(quickQuestion.statement, "Enunciado de teste.");
  assert.deepEqual(quickQuestion.options.map((option) => option.id), ["A", "B", "C", "D", "E"]);
  assert.equal(quickQuestion.options[1].text, "510");
  const inlineQuestion = modals.parseQuickQuestionText("A norma não inclui: A) Criar camadas B) Abstrair funções C) Maximizar o fluxo D) Preservar interfaces E) Definir funções");
  assert.deepEqual(inlineQuestion.options.map((option) => option.id), ["A", "B", "C", "D", "E"]);
  assert.equal(inlineQuestion.options[2].text, "Maximizar o fluxo");
  const batch = modals.parseQuickQuestionBatch("Questão 1: escolha uma opção.\n(A) primeira\n(B) X segunda\n(C) terceira\n---\nQuestão 2: escolha outra.\nA) X quarta\nB) quinta\nC) sexta");
  assert.equal(batch.length, 2);
  assert.equal(batch[0].correctOption, "B");
  assert.equal(batch[1].correctOption, "A");

  const answerKey = pdf.parseAnswerKey("1 - A\n2 - C");
  assert.equal(answerKey.get(1), "A");
  assert.equal(answerKey.get(2), "C");
  assert.equal(pdf.detectProofVersion("PROVA 6 - ANÁLISE DE SISTEMAS"), 6);

  const parsed = pdf.parseQuestions(`1\nA questão de teste tem alternativas.\n(A) primeira alternativa\n(B) segunda alternativa\n(C) terceira alternativa\n\n2\nOutro enunciado\nA) sim\nB) não`, new Map([[1, "B"], [2, "A"]]));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].number, 1);
  assert.equal(parsed[0].correctOption, "B");
  assert.equal(parsed[0].options.length, 3);
  assert.equal(parsed[1].options[0].id, "A");

  const nodes = [
    { id: "topic", roadmapId: "r1", kind: "topic", title: "Banco", order: 0, completed: false, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    { id: "sql", roadmapId: "r1", parentId: "topic", kind: "subtopic", title: "SQL", order: 0, completed: false, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    { id: "nosql", roadmapId: "r1", parentId: "topic", kind: "subtopic", title: "NoSQL", order: 1, completed: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ];
  assert.deepEqual(roadmap.getRoadmapProgress("r1", nodes), { roadmapId: "r1", total: 2, completed: 1, percentage: 50 });
  const completed = roadmap.setRoadmapNodeCompletion("topic", true, nodes, "2026-09-19T00:00:00.000Z");
  assert.equal(completed.find((node) => node.id === "sql").completed, true);
  assert.equal(completed.find((node) => node.id === "nosql").completed, true);
  assert.equal(roadmap.getRoadmapDescendantNodes("topic", nodes).length, 2);
  const moved = roadmap.moveRoadmapNode("nosql", "up", nodes, "2026-09-19T00:00:00.000Z");
  assert.equal(moved.find((node) => node.id === "nosql").order, 0);
  assert.equal(moved.find((node) => node.id === "sql").order, 1);

  assert.deepEqual(roadmap.parseRoadmapImportText("PARTE 1: Infraestrutura\n1. Redes\nArquiteturas\n2. Linux\nShell Script").map((item) => item.depth), [0, 2, 4, 2, 4]);
  assert.deepEqual(roadmap.parseRoadmapImportText("Banco de dados\n  SQL\n  - Consultas\nRedes"), [
    { title: "Banco de dados", depth: 0 },
    { title: "SQL", depth: 2 },
    { title: "Consultas", depth: 2 },
    { title: "Redes", depth: 0 },
  ]);
  const codeFence = String.fromCharCode(96).repeat(3);
  const bulkItems = roadmap.parseRoadmapImportText("- Topologia em Malha | Conexões redundantes\n  - Malha Completa | Usa N(N−1)2 enlaces\n- Arquitetura Spine-and-Leaf | Rede Clos\n" + codeFence + "\nN−1\n" + codeFence + "\n↔");
  assert.deepEqual(bulkItems.map((item) => ({ title: item.title, depth: item.depth })), [
    { title: "Topologia em Malha", depth: 0 },
    { title: "Malha Completa", depth: 2 },
    { title: "Arquitetura Spine-and-Leaf", depth: 0 },
  ]);
  assert.equal(bulkItems[0].description, "Conexões redundantes");
  assert.equal(bulkItems[1].description, "Usa N(N−1)2 enlaces");
  assert.equal(bulkItems[2].description, "Rede Clos N−1");

  const nestedMoveNodes = [
    { id: "parent", roadmapId: "r1", kind: "topic", title: "Redes", order: 0, completed: false, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    { id: "child-a", roadmapId: "r1", parentId: "parent", kind: "subtopic", title: "Arquitetura", order: 0, completed: false, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    { id: "child-b", roadmapId: "r1", parentId: "parent", kind: "subtopic", title: "Topologias", order: 0, completed: false, createdAt: "2026-01-02", updatedAt: "2026-01-02" },
  ];
  const movedNested = roadmap.moveRoadmapNode("child-b", "up", nestedMoveNodes, "2026-09-20T00:00:00.000Z");
  assert.equal(movedNested.find((node) => node.id === "child-b").order, 0);
  assert.equal(movedNested.find((node) => node.id === "child-a").order, 1);

  const priorityNodes = [
    { id: "p-none", roadmapId: "r1", title: "Normal", order: 0, priority: "none" },
    { id: "p-urgent", roadmapId: "r1", title: "Urgente", order: 3, priority: "urgent" },
    { id: "p-high", roadmapId: "r1", title: "Alta", order: 1, priority: "high" },
  ];
  assert.deepEqual(roadmap.buildRoadmapChildren(priorityNodes).get(undefined).map((node) => node.id), ["p-urgent", "p-high", "p-none"]);

  const materialProgress = roadmap.getRoadmapMaterialProgress([
    { id: "link-card", nodeId: "topic", resourceType: "flashcard", resourceId: "card-1", order: 0, createdAt: "2026-01-01" },
    { id: "link-question", nodeId: "topic", resourceType: "quiz-question", resourceId: "q1", order: 1, createdAt: "2026-01-01" },
  ], [{ id: "card-1", repetitions: 2, lastReviewAt: "2026-01-02" }], [{ questionIds: ["q1"], answers: { q1: "A" } }], ["topic"]);
  assert.deepEqual(materialProgress, { total: 2, completed: 2, percentage: 100, flashcardsTotal: 1, flashcardsCompleted: 1, questionsTotal: 1, questionsAnswered: 1 });

  console.log("quiz and roadmap tests: ok");
} finally {
  await server.close();
}

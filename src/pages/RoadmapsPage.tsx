import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  Flag,
  FilePlus2,
  CheckCircle2,
  Link2,
  ListChecks,
  Loader2,
  Pencil,
  Play,
  Plus,
  Route,
  StickyNote,
  Target,
  Trash2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ProgressBar, RoadmapTree } from "@/components/features/roadmaps/RoadmapTree";
import { LinkModal, NodeFormModal, RoadmapFormModal, SubtopicQuickCreateModal, type NodeForm, type RoadmapForm, type SubtopicQuickCreateForm } from "@/components/features/roadmaps/RoadmapModals";
import { RoadmapImportModal } from "@/components/features/roadmaps/RoadmapImportModal";
import { formatRoadmapImportText, getRoadmapMaterialProgress, getRoadmapPriorityWeight, getRoadmapProgress, parseRoadmapImportText, ROADMAP_PRIORITY_OPTIONS } from "@core/lib/roadmap";
import type { StudyRoadmap, StudyRoadmapLink, StudyRoadmapNode, StudyRoadmapPriority } from "@core/types/roadmap";
import { useRoadmapStore } from "@/store/useRoadmapStore";
import { useFlashcardStore } from "@/store/useFlashcardStore";
import { useQuizStore } from "@/store/useQuizStore";
import { useDiagramStore } from "@/store/useDiagramStore";
import { useAppStore } from "@/store/useAppStore";
import { RetroButton } from "@/components/ui/RetroButton";
import { ConfirmDialog } from "@/components/ui/RetroModal";
import { SearchableDropdown } from "@/components/ui/SearchableDropdown";

const emptyRoadmapForm: RoadmapForm = {
  title: "",
  description: "",
  objective: "",
  status: "draft",
  startDate: "",
  targetDate: "",
};

const emptyNodeForm: NodeForm = {
  title: "",
  kind: "topic",
  parentId: "",
  description: "",
  notes: "",
  priority: "none",
};

export function RoadmapsPage() {
  const hydrated = useRoadmapStore((state) => state.hydrated);
  const roadmapError = useRoadmapStore((state) => state.error);
  const initializeRoadmaps = useRoadmapStore((state) => state.initialize);
  const roadmaps = useRoadmapStore((state) => state.roadmaps);
  const nodes = useRoadmapStore((state) => state.nodes);
  const links = useRoadmapStore((state) => state.links);
  const addRoadmap = useRoadmapStore((state) => state.addRoadmap);
  const updateRoadmap = useRoadmapStore((state) => state.updateRoadmap);
  const deleteRoadmap = useRoadmapStore((state) => state.deleteRoadmap);
  const addNode = useRoadmapStore((state) => state.addNode);
  const updateNode = useRoadmapStore((state) => state.updateNode);
  const toggleNode = useRoadmapStore((state) => state.toggleNode);
  const deleteNode = useRoadmapStore((state) => state.deleteNode);
  const moveNode = useRoadmapStore((state) => state.moveNode);
  const addLink = useRoadmapStore((state) => state.addLink);
  const deleteLink = useRoadmapStore((state) => state.deleteLink);
  const cards = useFlashcardStore((state) => state.cards);
  const questions = useQuizStore((state) => state.questions);
  const attempts = useQuizStore((state) => state.attempts);
  const diagrams = useDiagramStore((state) => state.diagrams);
  const openFlashcard = useAppStore((state) => state.openFlashcard);
  const openQuizQuestion = useAppStore((state) => state.openQuizQuestion);
  const startFlashcardStudy = useAppStore((state) => state.startFlashcardStudy);
  const startQuizWithQuestions = useAppStore((state) => state.startQuizWithQuestions);
  const openDiagram = useAppStore((state) => state.openDiagram);

  useEffect(() => {
    if (!hydrated && !roadmapError) void initializeRoadmaps();
  }, [hydrated, roadmapError, initializeRoadmaps]);

  const [selectedId, setSelectedId] = useState<string | null>(roadmaps[0]?.id ?? null);
  const [roadmapModal, setRoadmapModal] = useState<{ open: boolean; editing: StudyRoadmap | null }>({ open: false, editing: null });
  const [nodeModal, setNodeModal] = useState<{ open: boolean; editing: StudyRoadmapNode | null }>({ open: false, editing: null });
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<StudyRoadmapNode | null>(null);
  const [roadmapToDelete, setRoadmapToDelete] = useState<StudyRoadmap | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [subtopicParent, setSubtopicParent] = useState<StudyRoadmapNode | null>(null);
  const [subtopicModalOpen, setSubtopicModalOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<"all" | StudyRoadmapPriority>("all");
  const [exportingRoadmap, setExportingRoadmap] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  const selectedRoadmap = roadmaps.find((roadmap) => roadmap.id === selectedId) ?? roadmaps[0] ?? null;
  const roadmapNodes = useMemo(() => selectedRoadmap ? nodes.filter((node) => node.roadmapId === selectedRoadmap.id) : [], [nodes, selectedRoadmap]);
  const visibleRoadmapNodes = useMemo(() => {
    if (priorityFilter === "all") return roadmapNodes;
    const byId = new Map(roadmapNodes.map((node) => [node.id, node]));
    const matches = (node: StudyRoadmapNode) => priorityFilter === "none" ? getRoadmapPriorityWeight(node.priority) === 0 : getRoadmapPriorityWeight(node.priority) >= getRoadmapPriorityWeight(priorityFilter);
    const visibleIds = new Set(roadmapNodes.filter(matches).map((node) => node.id));
    for (const node of roadmapNodes.filter(matches)) {
      let parentId = node.parentId;
      while (parentId) {
        visibleIds.add(parentId);
        parentId = byId.get(parentId)?.parentId;
      }
    }
    return roadmapNodes.filter((node) => visibleIds.has(node.id));
  }, [priorityFilter, roadmapNodes]);
  const selectedNode = roadmapNodes.find((node) => node.id === selectedNodeId) ?? roadmapNodes[0] ?? null;
  const selectedLinks = selectedNode ? links.filter((link) => link.nodeId === selectedNode.id).sort((left, right) => left.order - right.order) : [];
  const selectedFlashcardIds = selectedLinks.filter((link) => link.resourceType === "flashcard").map((link) => link.resourceId);
  const selectedQuestionIds = selectedLinks.filter((link) => link.resourceType === "quiz-question").map((link) => link.resourceId);
  const progress = selectedRoadmap ? getRoadmapProgress(selectedRoadmap.id, roadmapNodes) : { total: 0, completed: 0, percentage: 0 };
  const materialProgress = getRoadmapMaterialProgress(links, cards, attempts, selectedNode ? [selectedNode.id] : []);
  const roadmapForm = roadmapModal.editing
    ? { title: roadmapModal.editing.title, description: roadmapModal.editing.description ?? "", objective: roadmapModal.editing.objective ?? "", status: roadmapModal.editing.status, startDate: roadmapModal.editing.startDate ?? "", targetDate: roadmapModal.editing.targetDate ?? "" }
    : emptyRoadmapForm;
  const nodeForm = nodeModal.editing
    ? { title: nodeModal.editing.title, kind: nodeModal.editing.kind, parentId: nodeModal.editing.parentId ?? "", description: nodeModal.editing.description ?? "", notes: nodeModal.editing.notes ?? "", priority: nodeModal.editing.priority ?? "none" }
    : { ...emptyNodeForm, parentId: selectedNode?.id ?? "" };

  const linkedTitle = (link: StudyRoadmapLink) => {
    if (link.resourceType === "flashcard") return cards.find((card) => card.id === link.resourceId)?.question ?? "Flashcard removido";
    if (link.resourceType === "diagram") return diagrams.find((diagram) => diagram.id === link.resourceId)?.title ?? "Fluxograma removido";
    const question = questions.find((item) => item.id === link.resourceId);
    return question ? "Questão " + (question.order ?? "?") + " · " + (question.topic || question.subject) : "Questão removida";
  };

  const saveSubtopic = async (form: SubtopicQuickCreateForm) => {
    if (!selectedRoadmap || !subtopicParent) return;
    const created = await addNode({
      roadmapId: selectedRoadmap.id,
      parentId: subtopicParent.id,
      kind: "subtopic",
      title: form.title,
      description: form.description,
      notes: form.notes,
      priority: form.priority,
    });
    setSelectedNodeId(created.id);
    setSubtopicParent(null);
    setSubtopicModalOpen(false);
  };

  const saveSubtopicsBulk = async (text: string, priority: StudyRoadmapPriority) => {
    if (!selectedRoadmap || !subtopicParent) return;
    const stack: Array<{ depth: number; id: string }> = [{ depth: -1, id: subtopicParent.id }];
    let lastCreated: StudyRoadmapNode | null = null;

    for (const line of parseRoadmapImportText(text)) {
      while (stack.length > 0 && stack[stack.length - 1].depth >= line.depth) stack.pop();
      const parentId = stack[stack.length - 1]?.id ?? subtopicParent.id;
      const created = await addNode({
        roadmapId: selectedRoadmap.id,
        parentId,
        kind: "subtopic",
        title: line.title,
        description: line.description,
        priority,
      });
      stack.push({ depth: line.depth, id: created.id });
      lastCreated = created;
    }

    if (lastCreated) setSelectedNodeId(lastCreated.id);
    setSubtopicParent(null);
    setSubtopicModalOpen(false);
  };

  const saveRoadmap = async (form: RoadmapForm) => {
    if (roadmapModal.editing) await updateRoadmap(roadmapModal.editing.id, form);
    else {
      const created = await addRoadmap(form);
      setSelectedId(created.id);
    }
    setRoadmapModal({ open: false, editing: null });
  };

  const exportSelectedRoadmap = async () => {
    if (!selectedRoadmap || roadmapNodes.length === 0) return;
    setExportingRoadmap(true);
    setExportMessage(null);
    try {
      const text = formatRoadmapImportText(roadmapNodes);
      if (desktop) {
        const savedPath = await invoke<string>("save_roadmap_import", { title: selectedRoadmap.title, text });
        setExportMessage(`Formato salvo em Downloads: ${savedPath.split(/[\\/]/).pop() ?? "trilha-importacao.txt"}`);
      } else {
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${selectedRoadmap.title.replace(/[<>:"/\\|?*]+/g, "-").trim() || "trilha"}-importacao.txt`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setExportMessage("Formato exportado. O arquivo está pronto para a criação em massa.");
      }
    } catch (cause) {
      setExportMessage(cause instanceof Error ? cause.message : "Não foi possível exportar a trilha.");
    } finally {
      setExportingRoadmap(false);
    }
  };

  const saveNode = async (form: NodeForm) => {
    if (!selectedRoadmap) return;
    if (nodeModal.editing) {
      await updateNode(nodeModal.editing.id, form);
      setSelectedNodeId(nodeModal.editing.id);
    } else {
      const created = await addNode({ ...form, roadmapId: selectedRoadmap.id, parentId: form.parentId || undefined });
      setSelectedNodeId(created.id);
    }
    setNodeModal({ open: false, editing: null });
  };

  const importRoadmapTopics = async (text: string, importedTitle: string) => {
    let targetRoadmap = selectedRoadmap;
    if (!targetRoadmap) {
      targetRoadmap = await addRoadmap({ title: importedTitle, status: "draft" });
      setSelectedId(targetRoadmap.id);
    }
    const stack: Array<{ depth: number; id: string }> = [];
    for (const line of parseRoadmapImportText(text)) {
      while (stack.length > 0 && stack[stack.length - 1].depth >= line.depth) stack.pop();
      const parentId = stack[stack.length - 1]?.id;
      const created = await addNode({ roadmapId: targetRoadmap.id, parentId, kind: parentId ? "subtopic" : "topic", title: line.title, description: line.description });
      stack.push({ depth: line.depth, id: created.id });
    }
    setImportModalOpen(false);
  };

  const treeContent = roadmapNodes.length === 0 ? <div className='p-8 border border-dashed border-retro-border rounded-xl text-center text-[12px] text-retro-comment'><ListChecks size={32} className='mx-auto mb-2 text-retro-orange' />Adicione o primeiro tópico da trilha.</div> : visibleRoadmapNodes.length === 0 ? <div className='p-8 border border-dashed border-retro-border rounded-xl text-center text-[12px] text-retro-comment'><Flag size={28} className='mx-auto mb-2 text-retro-orange' />Nenhum item encontrado com esse filtro.</div> : <RoadmapTree nodes={visibleRoadmapNodes} selectedId={selectedNode?.id ?? null} onSelect={(node) => setSelectedNodeId(node.id)} onToggle={(node) => void toggleNode(node.id, !node.completed)} onMove={(id, direction) => void moveNode(id, direction)} onAddChild={(node) => { setSelectedNodeId(node.id); setSubtopicParent(node); setSubtopicModalOpen(true); }} />;
  if (!hydrated) {
    return <div className="h-full flex items-center justify-center paper-page"><div className="text-center text-retro-comment"><Loader2 size={28} className="mx-auto mb-3 animate-spin text-retro-blue" /><p>Carregando suas trilhas...</p></div></div>;
  }

  if (roadmapError) {
    return <div className="h-full flex items-center justify-center paper-page p-6"><div className="max-w-md text-center"><AlertTriangle size={32} className="mx-auto mb-3 text-retro-orange" /><h2 className="text-retro-text font-semibold">Não foi possível carregar as trilhas</h2><p className="mt-2 text-[12px] text-retro-comment">{roadmapError}</p><RetroButton className="mt-4" onClick={() => void initializeRoadmaps()}>tentar novamente</RetroButton></div></div>;
  }

  return (
    <div className="h-full flex flex-col paper-page">
      <div className="paper-toolbar flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-retro-blue text-[15px] font-semibold flex items-center gap-2"><Route size={16} /> Roadmaps de estudos</h1>
          <p className="text-retro-comment text-[12px] mt-0.5">Organize o edital em uma trilha com progresso, anotações e material vinculado.</p>
        </div>
        <div className="flex gap-2"><RetroButton variant="ghost" icon={<FilePlus2 size={14} />} onClick={() => setImportModalOpen(true)}>importar edital</RetroButton><RetroButton variant="primary" icon={<Plus size={14} />} onClick={() => setRoadmapModal({ open: true, editing: null })}>nova trilha</RetroButton></div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        <aside className="border-r border-retro-border/60 bg-retro-bgDark overflow-y-auto retro-scrollbar p-3">
          <div className="text-[11px] uppercase tracking-widest text-retro-comment mb-2">suas trilhas ({roadmaps.length})</div>
          <div className="space-y-2">
            {roadmaps.map((roadmap) => {
              const roadmapProgress = getRoadmapProgress(roadmap.id, nodes.filter((node) => node.roadmapId === roadmap.id));
              return <button key={roadmap.id} type="button" onClick={() => { setSelectedId(roadmap.id); setSelectedNodeId(null); }} className={"w-full text-left p-3 rounded-lg border " + (selectedRoadmap?.id === roadmap.id ? "border-retro-blue bg-retro-blue/10" : "border-transparent hover:border-retro-border hover:bg-retro-panelHover")}><span className="block text-[13px] font-semibold text-retro-text truncate">{roadmap.title}</span><span className="block mt-1 text-[11px] text-retro-comment">{roadmapProgress.completed}/{roadmapProgress.total} concluídos · {roadmapProgress.percentage}%</span><ProgressBar value={roadmapProgress.percentage} /></button>;
            })}
          </div>
          {roadmaps.length === 0 && <div className="p-4 text-center text-[12px] text-retro-comment"><Route size={28} className="mx-auto mb-2 text-retro-blue" />Crie uma trilha para começar.</div>}
        </aside>

        <section className="min-h-[560px] overflow-y-auto retro-scrollbar bg-retro-bg p-4 md:p-6">
          {!selectedRoadmap ? <div className="h-full flex items-center justify-center text-center"><div className="max-w-md"><Target size={44} className="mx-auto text-retro-blue mb-4" /><h2 className="text-retro-text text-xl font-semibold">Sua trilha começa aqui</h2><p className="mt-2 text-[13px] text-retro-comment">Crie uma roadmap e transforme o edital em passos pequenos.</p><div className="mt-5"><div className="flex justify-center gap-2"><RetroButton variant="ghost" icon={<FilePlus2 size={14} />} onClick={() => setImportModalOpen(true)}>importar edital</RetroButton><RetroButton variant="primary" icon={<Plus size={14} />} onClick={() => setRoadmapModal({ open: true, editing: null })}>criar primeira trilha</RetroButton></div></div></div></div> : <>
            <div className="flex items-start justify-between gap-3 flex-wrap border-b border-retro-border/60 pb-4">
              <div className="min-w-0"><div className="flex items-center gap-2"><h2 className="text-retro-text text-xl font-semibold truncate">{selectedRoadmap.title}</h2><span className="retro-badge">{selectedRoadmap.status}</span></div><p className="text-[13px] text-retro-comment mt-1">{selectedRoadmap.description || "Sem descrição."}</p>{selectedRoadmap.objective && <p className="text-[12px] text-retro-text-dim mt-2"><strong>objetivo:</strong> {selectedRoadmap.objective}</p>}</div>
              <div className="flex gap-2"><RetroButton variant="ghost" icon={<Pencil size={13} />} onClick={() => setRoadmapModal({ open: true, editing: selectedRoadmap })}>editar</RetroButton><RetroButton variant="ghost" icon={<Trash2 size={13} />} onClick={() => setRoadmapToDelete(selectedRoadmap)}>excluir</RetroButton></div>
            </div>
            <div className="my-5 p-4 rounded-xl border border-retro-border bg-retro-panelHover"><div className="flex items-center justify-between text-[12px] mb-2"><span className="text-retro-text flex items-center gap-2"><CheckCircle2 size={15} className="text-retro-green" /> progresso dos itens</span><strong className="text-retro-blue">{progress.completed}/{progress.total} · {progress.percentage}%</strong></div><ProgressBar value={progress.percentage} /></div>
            <div className="mb-5 grid grid-cols-2 gap-2"><div className="rounded-lg border border-retro-border/60 bg-retro-panelHover p-3"><span className="block text-[10px] uppercase tracking-wider text-retro-comment">materiais revisados</span><strong className="block mt-1 text-retro-text">{materialProgress.completed}/{materialProgress.total}</strong><span className="text-[11px] text-retro-comment">{materialProgress.percentage}% do tópico</span></div><div className="rounded-lg border border-retro-border/60 bg-retro-panelHover p-3"><span className="block text-[10px] uppercase tracking-wider text-retro-comment">composição</span><strong className="block mt-1 text-retro-text">{materialProgress.flashcardsCompleted}/{materialProgress.flashcardsTotal} cartões</strong><span className="text-[11px] text-retro-comment">{materialProgress.questionsAnswered}/{materialProgress.questionsTotal} questões</span></div></div><div className="flex items-center justify-between gap-2 mb-3"><div><h3 className="text-retro-text font-semibold">Conteúdo da trilha</h3><p className="text-[12px] text-retro-comment">Marque os nós concluídos ou abra um item para editar.</p>{exportMessage && <p className="mt-1 text-[11px] text-retro-green">{exportMessage}</p>}</div><div className="flex gap-2"><RetroButton variant="ghost" disabled={exportingRoadmap || roadmapNodes.length === 0} icon={<Download size={13} />} onClick={() => void exportSelectedRoadmap}>{exportingRoadmap ? "exportando..." : "exportar em massa"}</RetroButton><RetroButton variant="ghost" icon={<FilePlus2 size={13} />} onClick={() => setImportModalOpen(true)}>importar edital</RetroButton><RetroButton icon={<Plus size={13} />} onClick={() => setNodeModal({ open: true, editing: null })}>novo tópico</RetroButton></div></div>
            <div className='mb-3 flex items-center gap-3 flex-wrap'>
              <div className='flex items-center gap-2 text-[11px] uppercase tracking-wider text-retro-comment'><Flag size={13} className='text-retro-orange' /> filtrar prioridade</div>
              <div className='w-full sm:w-64'><SearchableDropdown items={[{ id: 'all', label: 'todas as prioridades' }, ...ROADMAP_PRIORITY_OPTIONS.filter((option) => option.id !== 'none').map((option) => ({ id: option.id, label: option.label + ' ou maior', description: option.description }))]} value={priorityFilter} onChange={(value) => setPriorityFilter(value as 'all' | StudyRoadmapPriority)} placeholder='Todas as prioridades...' searchPlaceholder='Buscar prioridade...' charLimit={32} /></div>
              {priorityFilter !== 'all' && <span className='text-[11px] text-retro-comment'>{visibleRoadmapNodes.length} itens visíveis</span>}
            </div>
            {treeContent}          </>}
        </section>

        <aside className="border-l border-retro-border/60 bg-retro-bgDark overflow-y-auto retro-scrollbar p-4">
          {selectedNode ? <div className="space-y-5">
            <div className="flex items-start justify-between gap-2"><div><span className="text-[10px] uppercase tracking-widest text-retro-comment">{selectedNode.kind}</span><h3 className="text-retro-text font-semibold mt-1">{selectedNode.title}</h3></div><input type="checkbox" className="sketch-checkbox mt-1" checked={selectedNode.completed} onChange={() => void toggleNode(selectedNode.id, !selectedNode.completed)} /></div>
            {selectedNode.description && <p className="text-[12px] text-retro-text-dim">{selectedNode.description}</p>}
            <div className="border-t border-retro-border/60 pt-4"><h4 className="text-[12px] text-retro-text font-semibold flex items-center gap-2"><StickyNote size={14} className="text-retro-yellow" /> anotações</h4><p className="mt-2 text-[12px] text-retro-text-dim whitespace-pre-wrap">{selectedNode.notes || "Nenhuma anotação neste tópico."}</p></div>
            <div className="border-t border-retro-border/60 pt-4"><div className="flex items-center justify-between gap-2"><h4 className="text-[12px] text-retro-text font-semibold flex items-center gap-2"><Link2 size={14} className="text-retro-purple" /> materiais ({selectedLinks.length})</h4><div className="flex items-center gap-1"><RetroButton variant="ghost" className="!px-2 !py-1" onClick={() => setLinkModalOpen(true)} title="Vincular material" aria-label="Vincular material"><Link2 size={13} /></RetroButton><RetroButton variant="ghost" className="!px-2 !py-1" onClick={() => { setSelectedNodeId(selectedNode.id); setSubtopicParent(selectedNode); setSubtopicModalOpen(true); }} title="Adicionar subtópico" aria-label="Adicionar subtópico"><Plus size={13} /></RetroButton></div></div><div className="mt-2 space-y-2">{selectedLinks.map((link) => <div key={link.id} className="flex items-start gap-2 p-2 rounded border border-retro-border/60"><button type="button" className="text-[11px] text-retro-text flex-1 text-left hover:text-retro-blue" onClick={() => link.resourceType === "flashcard" ? openFlashcard(link.resourceId) : link.resourceType === "diagram" ? openDiagram(link.resourceId) : openQuizQuestion(link.resourceId)}>{linkedTitle(link)}</button><button type="button" className="text-retro-red" onClick={() => void deleteLink(link.id)} aria-label="Remover vínculo"><Trash2 size={13} /></button></div>)}{selectedLinks.length === 0 && <p className="text-[12px] text-retro-comment">Vincule um flashcard ou uma questão para revisar esse item.</p>}</div></div>
            <div className="border-t border-retro-border/60 pt-4"><p className="text-[11px] text-retro-comment mb-2">Comece uma sessão com o material deste tópico.</p><div className="flex flex-wrap gap-2"><RetroButton variant="primary" disabled={!selectedFlashcardIds.length} icon={<Play size={13} />} onClick={() => startFlashcardStudy(selectedFlashcardIds)}>estudar cartões</RetroButton><RetroButton variant="ghost" disabled={!selectedQuestionIds.length} icon={<ListChecks size={13} />} onClick={() => startQuizWithQuestions(selectedQuestionIds)}>simular questões</RetroButton></div></div>
            <div className="flex gap-2 pt-2"><RetroButton variant="ghost" icon={<Pencil size={13} />} onClick={() => setNodeModal({ open: true, editing: selectedNode })}>editar</RetroButton><RetroButton variant="ghost" icon={<Trash2 size={13} />} onClick={() => setNodeToDelete(selectedNode)}>excluir</RetroButton></div>
          </div> : <div className="h-full flex items-center justify-center text-center text-[12px] text-retro-comment"><Target size={32} className="mx-auto mb-2 text-retro-blue" />Selecione um tópico para ver detalhes.</div>}
        </aside>
      </div>

      <RoadmapImportModal open={importModalOpen} onClose={() => setImportModalOpen(false)} onImport={importRoadmapTopics} />
      <RoadmapFormModal key={roadmapModal.editing?.id ?? (roadmapModal.open ? "new-open" : "new-closed")} open={roadmapModal.open} initial={roadmapForm} onClose={() => setRoadmapModal({ open: false, editing: null })} onSave={saveRoadmap} />
      {selectedRoadmap && <NodeFormModal key={nodeModal.editing?.id ?? (nodeModal.open ? "new-open" : "new-closed")} open={nodeModal.open} initial={nodeForm} nodes={roadmapNodes} editingId={nodeModal.editing?.id ?? null} onClose={() => setNodeModal({ open: false, editing: null })} onSave={saveNode} />}
      <SubtopicQuickCreateModal key={subtopicModalOpen ? "subtopic-create-open" : "subtopic-create-closed"} open={subtopicModalOpen} parent={subtopicParent} initial={{ title: "", description: "", notes: "", priority: "none" }} onClose={() => { setSubtopicModalOpen(false); setSubtopicParent(null); }} onSave={saveSubtopic} onSaveBulk={saveSubtopicsBulk} />
      <LinkModal open={linkModalOpen} node={selectedNode} diagrams={diagrams} onClose={() => setLinkModalOpen(false)} onSave={async (resourceType, resourceId) => { if (selectedNode) await addLink({ nodeId: selectedNode.id, resourceType, resourceId }); setLinkModalOpen(false); }} />
      <ConfirmDialog open={Boolean(roadmapToDelete)} title="Excluir trilha?" message={"A trilha “" + (roadmapToDelete?.title ?? "") + "” e todos os seus tópicos e vínculos serão removidos."} tone="danger" onCancel={() => setRoadmapToDelete(null)} onConfirm={async () => { if (roadmapToDelete) { await deleteRoadmap(roadmapToDelete.id); setSelectedId(null); setSelectedNodeId(null); } setRoadmapToDelete(null); }} />
      <ConfirmDialog open={Boolean(nodeToDelete)} title="Excluir tópico?" message={"“" + (nodeToDelete?.title ?? "") + "” e seus subtópicos serão removidos."} tone="danger" onCancel={() => setNodeToDelete(null)} onConfirm={async () => { if (nodeToDelete) { await deleteNode(nodeToDelete.id); setSelectedNodeId(null); } setNodeToDelete(null); }} />
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";
import QRCode from "qrcode";
import { CheckCircle2, Copy, Download, FileUp, QrCode, RefreshCw, ScanLine, ShieldCheck, Smartphone, Upload, Wifi } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { RetroBadge } from "@/components/ui/RetroBadge";
import { RetroButton } from "@/components/ui/RetroButton";
import { RetroCard } from "@/components/ui/RetroCard";
import { applySyncPackage, createSyncPackage, decryptSyncPayload, downloadSyncPackage, encodePairingInvite, encryptSyncPackage, getDeviceIdentity, makePairingToken, parsePairingInvite, parseSyncPackage, previewSyncPackage, readLocalSyncData, saveDeviceName, type ConflictChoice, type SyncHostInfo, type SyncIdentity, type SyncPackage, type SyncPreview, type SyncRecord } from "@core/lib/sync";

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "sem data registrada";
}

function formatHostExpiry(value: number) {
  return new Date(value * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function describeRecord(record?: SyncRecord) {
  if (!record) return "registro removido";
  const value = [record.title, record.name, record.statement, record.question, record.front, record.topic, record.content].find((item) => typeof item === "string" && item.trim());
  return String(value || record.id).replace(/\s+/g, " ").slice(0, 190);
}

function SummaryItem({ label, value, tone }: { label: string; value: number; tone: "blue" | "green" | "orange" | "purple" }) {
  return <RetroCard accent={tone} className="!p-4"><p className="text-2xl font-bold text-retro-text">{value}</p><p className="mt-1 text-[12px] text-retro-comment">{label}</p></RetroCard>;
}

function PairingQr({ value }: { value: string }) {
  const [src, setSrc] = useState<string>();

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(value, { width: 220, margin: 2, errorCorrectionLevel: "M" }).then((dataUrl) => {
      if (active) setSrc(dataUrl);
    });
    return () => { active = false; };
  }, [value]);

  return <div className="inline-flex rounded-wobbly bg-white p-3" aria-label="QR Code do convite de pareamento">
    {src ? <img src={src} alt="QR Code do convite de pareamento" className="h-52 w-52" /> : <div className="flex h-52 w-52 items-center justify-center text-xs text-slate-500">gerando QR...</div>}
  </div>;
}

function PairingQrScanner({ onDetected }: { onDetected: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const reader = new BrowserQRCodeReader();
    let controls: { stop: () => void } | undefined;
    void reader.decodeFromVideoDevice(undefined, video, (result) => {
      const value = result?.getText();
      if (value) onDetected(value);
    }).then((nextControls) => {
      controls = nextControls;
    }).catch(() => setError("Não foi possível acessar a câmera deste dispositivo."));
    return () => controls?.stop();
  }, [onDetected]);

  return <div className="space-y-2 rounded-wobbly border border-retro-purple/50 bg-retro-purple/10 p-3">
    <video ref={videoRef} className="aspect-video w-full rounded-wobbly bg-black object-cover" muted playsInline />
    <p className="text-[12px] text-retro-comment">Aponte a câmera para o QR Code exibido no outro dispositivo.</p>
    {error && <p className="text-[12px] text-retro-red">{error}</p>}
  </div>;
}

export type SyncTab = "pair" | "files" | "conflicts";

export function SyncPanel({ activeTab, onPackageReceived }: { activeTab?: SyncTab; onPackageReceived?: (tab: SyncTab) => void }) {
  const [identity, setIdentity] = useState<SyncIdentity>(() => getDeviceIdentity());
  const [packageData, setPackageData] = useState<SyncPackage | null>(null);
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [conflictChoices, setConflictChoices] = useState<Record<string, ConflictChoice>>({});
  const [hostInfo, setHostInfo] = useState<SyncHostInfo | null>(null);
  const [remoteAddress, setRemoteAddress] = useState("");
  const [remoteSession, setRemoteSession] = useState<{ address: string; token: string } | null>(null);
  const [remoteToken, setRemoteToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [applied, setApplied] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  useEffect(() => () => {
    if (desktop) void invoke("stop_sync_host");
  }, [desktop]);

  const sourceIsThisDevice = packageData?.source.deviceId === identity.deviceId;
  const totalIncoming = useMemo(() => packageData ? Object.values(packageData.collections).reduce((total, records) => total + records.length, 0) : 0, [packageData]);

  const setIncomingPackage = async (parsed: SyncPackage, name: string) => {
    const local = await readLocalSyncData();
    const nextPreview = previewSyncPackage(local, parsed);
    setPackageData(parsed);
    setPreview(nextPreview);
    setConflictChoices(Object.fromEntries(nextPreview.conflictRecords.map((conflict) => [conflict.key, "local"])));
    setFileName(name);
    setApplied(false);
    onPackageReceived?.(nextPreview.conflicts > 0 ? "conflicts" : "files");
  };

  useEffect(() => {
    if (!desktop || !hostInfo) return;
    let cancelled = false;
    const pollIncoming = async () => {
      try {
        const incoming = await invoke<{ payload: string; secret: string } | null>("take_sync_incoming");
        if (!incoming || cancelled) return;
        const parsed = parseSyncPackage(await decryptSyncPayload(incoming.payload, incoming.secret));
        await setIncomingPackage(parsed, "retorno · " + parsed.source.deviceName);
        if (!cancelled) setMessage("O outro notebook enviou os dados dele. Revise os conflitos antes de aplicar.");
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Não foi possível ler o retorno do outro notebook.");
      }
    };
    void pollIncoming();
    const timer = window.setInterval(() => void pollIncoming(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [desktop, hostInfo]);

  const handleExport = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const syncPackage = await createSyncPackage(identity);
      downloadSyncPackage(syncPackage);
      setMessage("Pacote criado. Transfira o arquivo .dunots para o outro notebook.");
    } catch {
      setError("Não foi possível criar o pacote de sincronização.");
    } finally {
      setBusy(false);
    }
  };

  const handleStartHost = async () => {
    if (!desktop) {
      setError("O pareamento pela rede está disponível no executável desktop. No navegador, use o pacote .dunots.");
      return;
    }
    setPairingBusy(true);
    setError("");
    setMessage("");
    try {
      const syncPackage = await createSyncPackage(identity);
      const token = makePairingToken();
      const encrypted = await encryptSyncPackage(syncPackage, token);
      const info = await invoke<SyncHostInfo>("start_sync_host", { package: encrypted, token });
      setHostInfo(info);
      setMessage("Compartilhamento iniciado. O token de pareamento será usado uma única vez.");
    } catch {
      setError("Não foi possível iniciar o compartilhamento. Verifique se o firewall permite a rede privada.");
    } finally {
      setPairingBusy(false);
    }
  };

  const handleStopHost = async () => {
    if (!desktop) return;
    await invoke("stop_sync_host");
    setHostInfo(null);
    setMessage("Compartilhamento encerrado e sessão invalidada.");
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Copiado para a área de transferência.");
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione o texto manualmente.");
    }
  };

  const handleConnect = async () => {
    const address = remoteAddress.trim().replace(/\/+$/, "");
    const token = remoteToken.trim();
    if (!address || !token) {
      setError("Informe o endereço e o token exibidos no outro notebook.");
      return;
    }
    setPairingBusy(true);
    setError("");
    setMessage("");
    try {
      const baseAddress = /^https?:\/\//i.test(address) ? address : "http://" + address;
      const response = await fetch(baseAddress + "/dunots-sync", { headers: { Authorization: "Bearer " + token } });
      if (!response.ok) throw new Error("O endereço ou token não foi aceito.");
      const envelope = await response.json() as { package?: string; sessionToken?: string };
      if (!envelope.package || !envelope.sessionToken) throw new Error("O outro notebook não retornou uma sessão válida.");
      const parsed = parseSyncPackage(await decryptSyncPayload(envelope.package, token));
      await setIncomingPackage(parsed, "pareamento · " + parsed.source.deviceName);
      setRemoteSession({ address: baseAddress, token: envelope.sessionToken });
      setMessage("Pacote recebido. Revise a prévia antes de aplicar. Depois, você poderá enviar seus dados de volta uma vez.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível conectar ao outro notebook.");
    } finally {
      setPairingBusy(false);
    }
  };

  const handleScannedInvite = (value: string) => {
    try {
      const invite = parsePairingInvite(JSON.parse(value));
      setRemoteAddress(invite.address);
      setRemoteToken(invite.token);
      setScannerOpen(false);
      setMessage("Convite lido. Confirme o recebimento para iniciar o pareamento.");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "QR Code de pareamento inválido.");
    }
  };

  const handleSendBack = async () => {
    if (!remoteSession) return;
    setPairingBusy(true);
    setError("");
    try {
      const ownPackage = await createSyncPackage(identity);
      const encrypted = await encryptSyncPackage(ownPackage, remoteSession.token);
      const response = await fetch(remoteSession.address + "/dunots-sync", { method: "POST", headers: { Authorization: "Bearer " + remoteSession.token, "Content-Type": "text/plain" }, body: encrypted });
      if (!response.ok) throw new Error("A sessão de retorno expirou ou já foi usada.");
      setRemoteSession(null);
      setMessage("Seus dados foram enviados de volta. O outro notebook verá uma nova prévia para confirmar.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível enviar seus dados de volta.");
    } finally {
      setPairingBusy(false);
    }
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    setApplied(false);
    try {
      await setIncomingPackage(parseSyncPackage(JSON.parse(await file.text())), file.name);
    } catch (reason) {
      setPackageData(null);
      setPreview(null);
      setFileName("");
      setError(reason instanceof Error ? reason.message : "Não foi possível ler este pacote.");
    } finally {
      setBusy(false);
    }
  };

  const chooseAll = (choice: ConflictChoice) => {
    if (!preview) return;
    setConflictChoices(Object.fromEntries(preview.conflictRecords.map((conflict) => [conflict.key, choice])));
  };

  const handleApply = async () => {
    if (!packageData || !preview) return;
    setBusy(true);
    setError("");
    try {
      await applySyncPackage(packageData, conflictChoices);
      setApplied(true);
      setMessage("Mesclagem concluída com as decisões escolhidas para cada conflito.");
    } catch {
      setError("A mesclagem não pôde ser concluída. Nenhum arquivo foi apagado automaticamente.");
    } finally {
      setBusy(false);
    }
  };

  const hostInvite = hostInfo ? encodePairingInvite(hostInfo) : "";

  const compact = activeTab !== undefined;

  return <div className={compact ? "p-1" : "h-full overflow-y-auto retro-scrollbar paper-page p-5 md:p-8"}>
    <div className="mx-auto max-w-6xl">
      {!compact && <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-[13px] font-semibold text-retro-blue">SINCRONIZAÇÃO</p><h1 className="text-3xl font-bold text-retro-text">Leve seus estudos com você</h1><p className="mt-1 max-w-2xl text-retro-comment">Pareie notebooks pela rede local ou transfira um pacote Dunots. A mesclagem é revisada antes de alterar os dados.</p></div>
        <RetroBadge tone="green" icon={<ShieldCheck size={13} />}>criptografado e temporário</RetroBadge>
      </div>}

      {(!compact || activeTab === "pair") && <RetroCard accent="purple" className="mt-7" title="Parear pela mesma rede Wi-Fi" icon={<Wifi size={16} />}>
        {!desktop ? <p className="text-[13px] leading-relaxed text-retro-text-dim">O pareamento direto está disponível no executável desktop. Neste navegador, gere e importe um pacote <code>.dunots</code> abaixo.</p> : <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <h2 className="font-semibold text-retro-text">Notebook que envia</h2>
            <p className="text-[13px] leading-relaxed text-retro-text-dim">Inicie um compartilhamento temporário. O pacote é criptografado antes de sair do dispositivo, o token inicial expira em 10 minutos e só pode abrir uma sessão.</p>
            {!hostInfo ? <RetroButton variant="primary" onClick={() => void handleStartHost()} disabled={pairingBusy} icon={<Wifi size={15} />}>{pairingBusy ? "iniciando..." : "iniciar compartilhamento"}</RetroButton> : <div className="space-y-3 rounded-wobbly border border-retro-green/50 bg-retro-green/10 p-3"><div className="flex flex-wrap items-start gap-4"><PairingQr value={hostInvite} /><div className="min-w-0 flex-1 space-y-3"><div><p className="text-[11px] uppercase tracking-wider text-retro-comment">endereço</p><code className="mt-1 block break-all text-[13px] text-retro-blue">{hostInfo.address}</code></div><div><p className="text-[11px] uppercase tracking-wider text-retro-comment">token de pareamento</p><code className="mt-1 block break-all text-[13px] text-retro-blue">{hostInfo.token}</code></div><p className="text-[12px] text-retro-comment">Expira às {formatHostExpiry(hostInfo.expires_at)}. Após o recebimento, o retorno usa uma sessão diferente e de uso único.</p></div></div><div className="flex flex-wrap gap-2"><RetroButton onClick={() => void handleCopy(hostInvite)} icon={<Copy size={14} />}>copiar convite</RetroButton><RetroButton onClick={() => void handleStopHost()}>encerrar</RetroButton></div></div>}
          </div>
          <div className="space-y-3">
            <h2 className="font-semibold text-retro-text">Notebook que recebe</h2>
            <p className="text-[13px] leading-relaxed text-retro-text-dim">Informe o endereço e o token exibidos pelo dispositivo que está enviando. O token não é armazenado no pacote.</p>
            <label className="block text-[13px] text-retro-text-dim">Endereço do outro notebook<input value={remoteAddress} onChange={(event) => setRemoteAddress(event.target.value)} className="retro-input mt-1" placeholder="Ex.: http://192.168.0.15:43127" /></label>
            <label className="block text-[13px] text-retro-text-dim">Token<input value={remoteToken} onChange={(event) => setRemoteToken(event.target.value)} className="retro-input mt-1" placeholder="Cole o token temporário" /></label>
            <div className="flex flex-wrap gap-2"><RetroButton variant="primary" onClick={() => void handleConnect()} disabled={pairingBusy} icon={<Download size={15} />}>{pairingBusy ? "conectando..." : "receber pacote pela rede"}</RetroButton><RetroButton onClick={() => setScannerOpen((current) => !current)} icon={scannerOpen ? <QrCode size={15} /> : <ScanLine size={15} />}>{scannerOpen ? "fechar leitor" : "ler QR Code"}</RetroButton></div>
            {scannerOpen && <PairingQrScanner onDetected={handleScannedInvite} />}
          </div>
        </div>}
      </RetroCard>}

      {(!compact || activeTab === "files") && <div className="mt-4 grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
        <RetroCard accent="blue" title="Este dispositivo" icon={<Smartphone size={16} />}>
          <div className="space-y-4">
            <label className="block text-[13px] text-retro-text-dim">Nome do dispositivo<input value={identity.deviceName} onChange={(event) => setIdentity((current) => ({ ...current, deviceName: saveDeviceName(event.target.value) }))} className="retro-input mt-1" maxLength={60} placeholder="Ex.: Notebook principal" /></label>
            <div className="rounded-wobbly border border-retro-border bg-retro-panelHover p-3"><p className="text-[11px] uppercase tracking-wider text-retro-comment">identificador permanente</p><code className="mt-1 block break-all text-[12px] text-retro-blue">{identity.deviceId}</code></div>
          </div>
        </RetroCard>

        <RetroCard accent="green" title="Enviar por arquivo" icon={<Download size={16} />}>
          <div className="space-y-4">
            <p className="text-[14px] leading-relaxed text-retro-text-dim">Gere um pacote com flashcards, desafios, questões, simulados, trilhas, fluxogramas, artigos e snippets. Depois envie o arquivo para o outro notebook por pendrive, rede ou mensageiro.</p>
            <div className="rounded-wobbly border border-retro-green/40 bg-retro-green/10 p-3 text-[12px] text-retro-text-dim"><ShieldCheck size={15} className="mr-2 inline text-retro-green" />A mesclagem preserva dados locais, reconhece exclusões e pede uma decisão quando os dois notebooks editaram o mesmo ID.</div>
            <RetroButton variant="primary" onClick={() => void handleExport()} disabled={busy} icon={<Download size={15} />}>{busy ? "preparando..." : "gerar pacote .dunots"}</RetroButton>
          </div>
        </RetroCard>
      </div>}

      {(!compact || activeTab === "files" || activeTab === "conflicts") && <RetroCard accent="orange" className="mt-4" title="Receber por arquivo" icon={<Upload size={16} />}>
        <div className="space-y-4">
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-wobbly border-2 border-dashed border-retro-border bg-retro-panelHover p-5 text-center hover:border-retro-blue">
            <FileUp size={25} className="text-retro-blue" />
            <span className="mt-2 text-[14px] font-semibold text-retro-text">{fileName || "Escolha um arquivo .dunots"}</span>
            <span className="mt-1 text-[12px] text-retro-comment">a prévia será calculada antes de alterar seus dados</span>
            <input type="file" accept=".dunots,.json,application/json" className="sr-only" onChange={(event) => void handleFile(event.target.files?.[0])} />
          </label>
          {error && <div className="rounded-wobbly border border-retro-red/50 bg-retro-red/10 p-3 text-[13px] text-retro-red">{error}</div>}
          {message && <div className="rounded-wobbly border border-retro-green/50 bg-retro-green/10 p-3 text-[13px] text-retro-green">{message}</div>}
          {packageData && preview && <div className="space-y-4 rounded-wobbly border border-retro-border bg-retro-panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-retro-text">Prévia da mesclagem</h2><p className="mt-1 text-[12px] text-retro-comment">Origem: {packageData.source.deviceName} · exportado em {formatDate(packageData.exportedAt)} · {totalIncoming} registros</p></div>{sourceIsThisDevice && <RetroBadge tone="orange">mesmo dispositivo</RetroBadge>}</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5"><SummaryItem label="novos" value={preview.added} tone="blue" /><SummaryItem label="atualizados" value={preview.updated} tone="green" /><SummaryItem label="excluídos" value={preview.deleted} tone="orange" /><SummaryItem label="iguais" value={preview.unchanged} tone="purple" /><SummaryItem label="conflitos" value={preview.conflicts} tone="orange" /></div>
            {preview.conflictRecords.length > 0 && <div className="space-y-3 border-t border-retro-border pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold text-retro-text">Conflitos para revisar</h3><p className="text-[12px] text-retro-comment">Cada escolha é aplicada somente ao ID indicado.</p></div><div className="flex flex-wrap gap-2"><RetroButton onClick={() => chooseAll("local")}>manter todos locais</RetroButton><RetroButton onClick={() => chooseAll("incoming")}>usar todas recebidas</RetroButton></div></div>{preview.conflictRecords.map((conflict) => { const choice = conflictChoices[conflict.key] ?? "local"; return <div key={conflict.key} className="rounded-wobbly border border-retro-border bg-retro-panelHover p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-[12px] font-semibold text-retro-blue">{conflict.collection} · {conflict.id}</p><p className="mt-1 text-[13px] text-retro-text">{describeRecord(conflict.incoming)}</p></div><span className="text-[11px] text-retro-comment">{choice === "local" ? "decisão: local" : "decisão: recebida"}</span></div><div className="mt-3 grid gap-3 md:grid-cols-2"><div className={`rounded-wobbly border p-3 ${choice === "local" ? "border-retro-blue bg-retro-blue/10" : "border-retro-border"}`}><p className="text-[11px] uppercase tracking-wider text-retro-comment">versão local · {formatDate(conflict.localUpdatedAt)}</p><p className="mt-1 text-[12px] text-retro-text-dim">{describeRecord(conflict.local)}</p><RetroButton className="mt-2" onClick={() => setConflictChoices((current) => ({ ...current, [conflict.key]: "local" }))}>manter local</RetroButton></div><div className={`rounded-wobbly border p-3 ${choice === "incoming" ? "border-retro-green bg-retro-green/10" : "border-retro-border"}`}><p className="text-[11px] uppercase tracking-wider text-retro-comment">versão recebida · {formatDate(conflict.incomingUpdatedAt)}</p><p className="mt-1 text-[12px] text-retro-text-dim">{describeRecord(conflict.incoming)}</p><RetroButton className="mt-2" onClick={() => setConflictChoices((current) => ({ ...current, [conflict.key]: "incoming" }))}>usar recebida</RetroButton></div></div></div>; })}</div>}
            {remoteSession && <div className="flex flex-wrap items-center justify-between gap-3 rounded-wobbly border border-retro-blue/40 bg-retro-blue/10 p-3"><p className="text-[12px] text-retro-text-dim">A sessão de retorno está pronta. Você pode enviar o estado deste notebook para o dispositivo que iniciou o pareamento.</p><RetroButton onClick={() => void handleSendBack()} disabled={pairingBusy} icon={<Upload size={14} />}>{pairingBusy ? "enviando..." : "enviar meus dados de volta"}</RetroButton></div>}
            {applied ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-retro-border pt-4"><p className="text-[13px] text-retro-green"><CheckCircle2 size={15} className="mr-1 inline" />Dados mesclados com sucesso.</p><RetroButton variant="primary" onClick={() => window.location.reload()} icon={<RefreshCw size={14} />}>recarregar dados</RetroButton></div> : <div className="flex justify-end border-t border-retro-border pt-4"><RetroButton variant="primary" disabled={busy || (!preview.added && !preview.updated && !preview.deleted && !preview.conflicts)} onClick={() => void handleApply()} icon={<Upload size={14} />}>{busy ? "mesclando..." : "aplicar mesclagem"}</RetroButton></div>}
          </div>}
        </div>
      </RetroCard>}
      {!compact && <p className="mt-5 text-[12px] text-retro-comment">O pareamento expira em 10 minutos, usa AES-GCM no payload, token inicial de uso único e sessão de retorno de uso único. As duas pontas precisam confirmar a mesclagem manualmente.</p>}
    </div>
  </div>;
}

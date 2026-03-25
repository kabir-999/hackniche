function statusTone(connectionState) {
    if (connectionState === 'connected') return 'bg-emerald-500'
    if (connectionState === 'connecting') return 'bg-amber-400'
    if (connectionState === 'error') return 'bg-red-500'
    return 'bg-slate-500'
}

function formatConnectionLabel(connectionState) {
    switch (connectionState) {
        case 'connecting':
            return 'Connecting backend'
        case 'connected':
            return 'Live'
        case 'disconnected':
            return 'Disconnected'
        case 'error':
            return 'Error'
        default:
            return 'Idle'
    }
}

function workerTone(worker) {
    if (worker.compliant) return 'border-emerald-400/60 bg-emerald-500/10'
    if (worker.violations.includes('helmet')) return 'border-red-400/70 bg-red-500/12'
    return 'border-amber-400/70 bg-amber-500/12'
}

export default function LivePpePanel({
    backendUrl,
    setBackendUrl,
    enabled,
    connectionState,
    error,
    frameRate,
    previewSrc,
    depthStats,
    workers,
    alerts,
    backendWorkerCount,
    backendDetectionCount,
    backendPersonCount,
    backendPpeCount,
    onStart,
    onStop,
}) {
    return (
        <div className="fixed top-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] flex flex-col gap-3">
            <div className="glass rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-slate-950/30">
                <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[11px] uppercase tracking-[0.24em] text-slate-300">Virtual PPE Monitor</p>
                        <p className="text-sm font-semibold text-white">Three.js Warehouse Streaming</p>
                    </div>
                    <div className="flex items-center gap-2 rounded-full bg-slate-950/50 px-3 py-1">
                        <span className={`h-2.5 w-2.5 rounded-full ${statusTone(connectionState)}`} />
                        <span className="text-[11px] font-medium text-slate-200">
                            {formatConnectionLabel(connectionState)}
                        </span>
                    </div>
                </div>

                <div className="p-4 flex flex-col gap-3">
                    <label className="flex flex-col gap-1.5">
                        <span className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
                            Backend WebSocket
                        </span>
                        <input
                            value={backendUrl}
                            onChange={(event) => setBackendUrl(event.target.value)}
                            disabled={enabled}
                            className="w-full rounded-xl border border-white/10 bg-slate-950/55 px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/60"
                            placeholder="ws://127.0.0.1:8000/ws/ppe"
                        />
                    </label>

                    <div className="rounded-2xl border border-white/10 bg-slate-950/60 overflow-hidden">
                        <div className="aspect-video bg-slate-950 relative">
                            {previewSrc ? (
                                <img
                                    src={previewSrc}
                                    alt="Live PPE preview"
                                    className="h-full w-full object-cover"
                                />
                            ) : (
                                <div className="absolute inset-0 grid place-items-center text-center px-6">
                                    <div>
                                        <p className="text-sm font-medium text-slate-100">No live frame yet</p>
                                        <p className="text-xs text-slate-400 mt-1">
                                            Start monitoring to stream the Three.js CCTV view to the backend.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="px-3 py-2 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-300">
                            <span>{backendWorkerCount} tracked workers</span>
                            <span>{frameRate} fps</span>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={enabled ? onStop : onStart}
                            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                                enabled
                                    ? 'bg-red-500/85 text-white hover:bg-red-400'
                                    : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
                            }`}
                        >
                            {enabled ? 'Stop Virtual Monitoring' : 'Start Virtual Monitoring'}
                        </button>
                    </div>

                    {error ? (
                        <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                            {error}
                        </div>
                    ) : null}

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
                            <p className="text-slate-400 uppercase tracking-[0.2em] text-[9px]">Alerts</p>
                            <p className="mt-1 text-lg font-semibold text-white">{alerts.length}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
                            <p className="text-slate-400 uppercase tracking-[0.2em] text-[9px]">Compliant</p>
                            <p className="mt-1 text-lg font-semibold text-white">
                                {workers.filter((worker) => worker.compliant).length}
                            </p>
                        </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-[11px] text-slate-300">
                        <div className="flex items-center justify-between">
                            <span>Tracked workers</span>
                            <span>{backendWorkerCount}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                            <span>Total detections</span>
                            <span>{backendDetectionCount}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                            <span>Person detections</span>
                            <span>{backendPersonCount}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                            <span>PPE detections</span>
                            <span>{backendPpeCount}</span>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                            <span>Depth graph</span>
                            <span>{depthStats ? 'Viewport active' : 'Off'}</span>
                        </div>
                    </div>

                    <div className="max-h-[260px] overflow-y-auto pr-1 flex flex-col gap-2">
                        {workers.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/25 px-3 py-4 text-center text-xs text-slate-400">
                                No workers were detected in the streamed frame yet. This panel uses backend CV output only, so if `Person detections` stays at 0 the model is missing avatar bodies.
                            </div>
                        ) : (
                            workers.map((worker) => (
                                <div
                                    key={worker.id}
                                    className={`rounded-xl border px-3 py-2 ${workerTone(worker)}`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-semibold text-white">{worker.id}</p>
                                            <p className="text-[11px] text-slate-300">
                                                {worker.compliant
                                                    ? 'Fully compliant'
                                                    : `Missing ${worker.violations.join(', ')}`}
                                            </p>
                                        </div>
                                        <div className="text-right text-[10px] text-slate-300">
                                            <p>Helmet {worker.helmet ? 'Yes' : 'No'}</p>
                                            <p>Vest {worker.vest ? 'Yes' : 'No'}</p>
                                            <p>Gloves {worker.gloves ? 'Yes' : 'No'}</p>
                                            <p>Mask {worker.mask == null ? 'N/A' : worker.mask ? 'Yes' : 'No'}</p>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

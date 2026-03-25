export default function Controls({
    lightingMode, setLightingMode,
    speed, setSpeed,
    workerCount, setWorkerCount,
    roomCount, setRoomCount,
    currentRoomName,
    complianceTargets, setComplianceTargets,
    onStartFire,
    onTriggerLadderFall,
    fireActive,
    ladderActive,
}) {
    const updateComplianceTarget = (item, value) => {
        setComplianceTargets((prev) => ({ ...prev, [item]: value }))
    }

    return (
        <div className="fixed top-4 left-4 z-50 flex flex-col gap-3">
            {/* Title bar */}
            <div className="glass rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-white text-sm font-semibold tracking-wide">
                    WAREHOUSE CCTV
                </span>
                <span className="text-gray-400 text-xs ml-2">
                    SIMULATION
                </span>
            </div>

            {/* Controls panel */}
            <div className="glass rounded-xl px-4 py-3 flex flex-col gap-3 min-w-[220px]">
                {/* Lighting */}
                <div>
                    <label className="text-gray-400 text-[10px] uppercase tracking-widest font-medium block mb-1.5">
                        Lighting Mode
                    </label>
                    <select
                        id="lighting-select"
                        value={lightingMode}
                        onChange={(e) => setLightingMode(e.target.value)}
                        className="w-full bg-gray-800/80 text-white text-sm rounded-lg px-3 py-2 border border-gray-600/50 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 cursor-pointer transition-all"
                    >
                        <option value="full">☀️ Fully Lit</option>
                        <option value="dim">💡 Dim (Indoor)</option>
                        <option value="dark">🌙 Dark (Floodlights)</option>
                    </select>
                </div>

                {/* Speed */}
                <div>
                    <label className="text-gray-400 text-[10px] uppercase tracking-widest font-medium block mb-1.5">
                        Simulation Speed
                    </label>
                    <select
                        id="speed-select"
                        value={speed}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                        className="w-full bg-gray-800/80 text-white text-sm rounded-lg px-3 py-2 border border-gray-600/50 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 cursor-pointer transition-all"
                    >
                        <option value={1}>▶ Normal (1×)</option>
                        <option value={2}>⏩ Fast (2×)</option>
                    </select>
                </div>

                {/* Worker count */}
                <div>
                    <label className="text-gray-400 text-[10px] uppercase tracking-widest font-medium block mb-1.5">
                        Workers ({workerCount})
                    </label>
                    <input
                        id="worker-count"
                        type="range"
                        min={1}
                        max={20}
                        value={workerCount}
                        onChange={(e) => setWorkerCount(Number(e.target.value))}
                        className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <div className="flex justify-between text-[9px] text-gray-500 mt-0.5">
                        <span>1</span>
                        <span>20</span>
                    </div>
                </div>

                <div>
                    <label className="text-gray-400 text-[10px] uppercase tracking-widest font-medium block mb-1.5">
                        Rooms ({roomCount})
                    </label>
                    <input
                        id="room-count"
                        type="range"
                        min={1}
                        max={6}
                        value={roomCount}
                        onChange={(e) => setRoomCount(Number(e.target.value))}
                        className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                    <div className="flex justify-between text-[9px] text-gray-500 mt-0.5">
                        <span>1</span>
                        <span>6</span>
                    </div>
                    <p className="text-[10px] text-emerald-300/80 mt-2">
                        Current: {currentRoomName}
                    </p>
                </div>
            </div>

            <div className="glass rounded-xl px-4 py-3">
                <p className="text-gray-400 text-[10px] uppercase tracking-widest font-medium mb-2.5">
                    Incidents
                </p>
                <div className="flex flex-col gap-2">
                    <button
                        onClick={onStartFire}
                        className={`w-full rounded-lg px-3 py-2 text-sm font-semibold transition ${
                            fireActive
                                ? 'bg-orange-500/85 text-white hover:bg-orange-400'
                                : 'bg-red-500/85 text-white hover:bg-red-400'
                        }`}
                    >
                        {fireActive ? `Fire Active In ${currentRoomName}` : 'Start Fire'}
                    </button>
                    <button
                        onClick={onTriggerLadderFall}
                        className={`w-full rounded-lg px-3 py-2 text-sm font-semibold transition ${
                            ladderActive
                                ? 'bg-amber-500/85 text-slate-950'
                                : 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
                        }`}
                    >
                        {ladderActive ? 'Ladder Fall Running' : 'Trigger Ladder Fall'}
                    </button>
                </div>
            </div>

            {/* PPE Compliance toggles */}
            <div className="glass rounded-xl px-4 py-3">
                <p className="text-gray-400 text-[10px] uppercase tracking-widest font-medium mb-2.5">
                    PPE Coverage
                </p>
                <div className="flex flex-col gap-2">
                    {[
                        { key: 'helmet', label: '⛑️ Helmet', color: 'bg-yellow-500' },
                        { key: 'vest', label: '🦺 Safety Vest', color: 'bg-orange-500' },
                        { key: 'gloves', label: '🧤 Gloves', color: 'bg-gray-500' },
                    ].map(({ key, label, color }) => (
                        <div key={key} className="rounded-lg bg-white/[0.03] px-3 py-2">
                            <div className="flex items-center justify-between gap-3 mb-1.5">
                                <div className="flex items-center gap-2.5">
                                    <div className={`w-3 h-3 rounded-sm ${color}`} />
                                    <span className="text-xs font-medium text-white">{label}</span>
                                </div>
                                <span className="text-[10px] text-gray-400">
                                    {complianceTargets[key]}%
                                </span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={100}
                                step={5}
                                value={complianceTargets[key]}
                                onChange={(e) => updateComplianceTarget(key, Number(e.target.value))}
                                className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            />
                            <div className="mt-1.5 flex items-center justify-between text-[9px] text-gray-500">
                                <span>0%</span>
                                <span>
                                    {Math.round((workerCount * complianceTargets[key]) / 100)} of {workerCount} workers
                                </span>
                                <span>100%</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Keyboard hint */}
            <div className="glass rounded-xl px-4 py-2.5">
                <p className="text-gray-500 text-[10px] uppercase tracking-widest font-medium mb-1.5">Camera</p>
                <div className="mb-2">
                    <p className="text-[9px] text-gray-500 mb-1">Angle</p>
                    <div className="flex gap-1 justify-center mb-1">
                        <kbd className="bg-gray-700/60 text-gray-300 text-[10px] px-2 py-0.5 rounded border border-gray-600/40">W</kbd>
                    </div>
                    <div className="flex gap-1 justify-center">
                        <kbd className="bg-gray-700/60 text-gray-300 text-[10px] px-2 py-0.5 rounded border border-gray-600/40">A</kbd>
                        <kbd className="bg-gray-700/60 text-gray-300 text-[10px] px-2 py-0.5 rounded border border-gray-600/40">S</kbd>
                        <kbd className="bg-gray-700/60 text-gray-300 text-[10px] px-2 py-0.5 rounded border border-gray-600/40">D</kbd>
                    </div>
                </div>
                <div>
                    <p className="text-[9px] text-gray-500 mb-1 text-center">Pan</p>
                    <div className="flex gap-1 justify-center mb-1">
                        <kbd className="bg-gray-700/60 text-gray-300 text-[10px] px-2 py-0.5 rounded border border-gray-600/40">↑</kbd>
                    </div>
                    <div className="flex gap-1 justify-center">
                        <kbd className="bg-gray-700/60 text-gray-300 text-[10px] px-2 py-0.5 rounded border border-gray-600/40">←</kbd>
                        <kbd className="bg-gray-700/60 text-gray-300 text-[10px] px-2 py-0.5 rounded border border-gray-600/40">↓</kbd>
                        <kbd className="bg-gray-700/60 text-gray-300 text-[10px] px-2 py-0.5 rounded border border-gray-600/40">→</kbd>
                    </div>
                </div>
            </div>
        </div>
    )
}

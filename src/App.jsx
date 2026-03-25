import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './components/Scene'
import Worker from './components/Worker'
import Controls from './components/Controls'

const INCIDENT_WEBHOOK_URL = 'https://aagnya.app.n8n.cloud/webhook-test/incident-alert'
const PPE_ITEMS = [
    { key: 'helmet', label: 'Helmet' },
    { key: 'vest', label: 'Vest' },
    { key: 'gloves', label: 'Gloves' },
]

const HUB_AREA = { id: 'hub', name: 'Open Bay', accent: '#22d3ee' }
const ROOM_LIBRARY = [
    { id: 'receiving', name: 'Receiving Bay', accent: '#38bdf8' },
    { id: 'packing', name: 'Packing Hall', accent: '#f59e0b' },
    { id: 'cold', name: 'Cold Storage', accent: '#60a5fa' },
    { id: 'maintenance', name: 'Maintenance Shop', accent: '#ef4444' },
    { id: 'quality', name: 'Quality Control', accent: '#a855f7' },
    { id: 'dispatch', name: 'Dispatch Dock', accent: '#22c55e' },
]
const INCIDENT_SOURCES = {
    hub: {
        fire: [9.5, 0, 5.6],
        ladder: [-6.5, 0, 8.2],
    },
    receiving: {
        fire: [6.4, 0, 1.2],
        ladder: [10.8, 0, -6.2],
    },
    packing: {
        fire: [1.6, 0, 6.4],
        ladder: [-10.8, 0, 5.7],
    },
    cold: {
        fire: [6.2, 0, 5],
        ladder: [-9.5, 0, 6.9],
    },
    maintenance: {
        fire: [1.1, 0, -2],
        ladder: [-8.6, 0, 6.3],
    },
    quality: {
        fire: [-1.4, 0, 7.1],
        ladder: [10.4, 0, 6.4],
    },
    dispatch: {
        fire: [4.3, 0, 5.1],
        ladder: [-10.6, 0, 6.4],
    },
}

function buildIncidentNotification(id, title, message, tone = 'info') {
    return { id, title, message, tone }
}

function getAssignmentScore(workerIndex, complianceKey) {
    let hash = workerIndex + 1

    for (const char of complianceKey) {
        hash = (hash * 31 + char.charCodeAt(0)) % 2147483647
    }

    return hash
}

function getRoomWorkerProfiles(roomId) {
    const profilesByRoom = {
        hub: [
            { taskType: 'patrol', route: [[-12, 0, -6], [-7, 0, -6], [-2, 0, -6], [3, 0, -6]] },
            { taskType: 'carry', route: [[-10, 0, 2], [-6, 0, 3], [-2, 0, 3], [2, 0, 2]] },
            { taskType: 'inspect', route: [[5, 0, -2], [8, 0, -2], [11, 0, -2]] },
            { taskType: 'sort', route: [[-8, 0, 7], [-4, 0, 8], [0, 0, 8], [4, 0, 7]] },
            { taskType: 'lift', route: [[7, 0, 6], [10, 0, 6], [13, 0, 5]] },
            { taskType: 'patrol', route: [[-13, 0, 9], [-8, 0, 9], [-3, 0, 9], [2, 0, 9]] },
        ],
        receiving: [
            { taskType: 'carry', route: [[-12, 0, -1], [-8, 0, -1], [-4, 0, -1], [1, 0, -1]] },
            { taskType: 'carry', route: [[-13, 0, 4], [-9, 0, 5], [-5, 0, 5], [-1, 0, 4]] },
            { taskType: 'inspect', route: [[2, 0, -5], [5, 0, -5], [8, 0, -5], [11, 0, -5]] },
            { taskType: 'sort', route: [[4, 0, 3], [7, 0, 4], [10, 0, 3], [7, 0, 1.5]] },
            { taskType: 'lift', route: [[-2, 0, 6], [2, 0, 6], [6, 0, 6]] },
            { taskType: 'patrol', route: [[-11, 0, 8], [-6, 0, 8], [-1, 0, 8], [4, 0, 8]] },
        ],
        packing: [
            { taskType: 'sort', route: [[-11, 0, -4], [-7, 0, -4], [-3, 0, -4], [1, 0, -4]] },
            { taskType: 'inspect', route: [[-10, 0, 2], [-6, 0, 2], [-2, 0, 2], [2, 0, 2]] },
            { taskType: 'carry', route: [[4, 0, -6], [7, 0, -4], [10, 0, -2], [12, 0, 0]] },
            { taskType: 'sort', route: [[4, 0, 5], [8, 0, 5], [11, 0, 4], [8, 0, 2]] },
            { taskType: 'lift', route: [[-1, 0, 7], [3, 0, 7], [7, 0, 7]] },
            { taskType: 'patrol', route: [[-12, 0, 8], [-7, 0, 8], [-2, 0, 8], [3, 0, 8]] },
        ],
        cold: [
            { taskType: 'inspect', route: [[-11, 0, -6], [-7, 0, -6], [-3, 0, -6], [1, 0, -6]] },
            { taskType: 'carry', route: [[-10, 0, 5], [-6, 0, 5], [-2, 0, 5], [2, 0, 5]] },
            { taskType: 'sort', route: [[4, 0, -2], [8, 0, -2], [11, 0, -1], [8, 0, 1]] },
            { taskType: 'patrol', route: [[-12, 0, 8], [-8, 0, 8], [-4, 0, 8], [0, 0, 8]] },
            { taskType: 'carry', route: [[3, 0, 7], [6, 0, 7], [9, 0, 7], [12, 0, 7]] },
            { taskType: 'inspect', route: [[6, 0, 2], [9, 0, 2], [12, 0, 2]] },
        ],
        maintenance: [
            { taskType: 'lift', route: [[-11, 0, -4], [-7, 0, -4], [-3, 0, -4], [1, 0, -4]] },
            { taskType: 'inspect', route: [[-10, 0, 3], [-6, 0, 3], [-2, 0, 3], [2, 0, 3]] },
            { taskType: 'sort', route: [[5, 0, -6], [8, 0, -4], [11, 0, -2]] },
            { taskType: 'lift', route: [[4, 0, 6], [7, 0, 6], [10, 0, 6]] },
            { taskType: 'patrol', route: [[-12, 0, 8], [-7, 0, 8], [-2, 0, 8], [3, 0, 8]] },
            { taskType: 'carry', route: [[0, 0, 0], [3, 0, 1], [6, 0, 0], [9, 0, 1]] },
        ],
        quality: [
            { taskType: 'inspect', route: [[-11, 0, -5], [-7, 0, -5], [-3, 0, -5], [1, 0, -5]] },
            { taskType: 'inspect', route: [[-10, 0, 2], [-6, 0, 2], [-2, 0, 2], [2, 0, 2]] },
            { taskType: 'sort', route: [[5, 0, -2], [8, 0, -1], [11, 0, -2]] },
            { taskType: 'patrol', route: [[-12, 0, 7], [-8, 0, 7], [-4, 0, 7], [0, 0, 7]] },
            { taskType: 'carry', route: [[3, 0, 6], [6, 0, 6], [9, 0, 6], [12, 0, 6]] },
            { taskType: 'sort', route: [[4, 0, 0], [7, 0, 0], [10, 0, 0]] },
        ],
        dispatch: [
            { taskType: 'carry', route: [[-12, 0, -2], [-8, 0, -2], [-4, 0, -2], [0, 0, -2]] },
            { taskType: 'carry', route: [[-11, 0, 4], [-7, 0, 4], [-3, 0, 4], [1, 0, 4]] },
            { taskType: 'lift', route: [[4, 0, -6], [7, 0, -5], [10, 0, -4], [12, 0, -3]] },
            { taskType: 'patrol', route: [[-12, 0, 8], [-7, 0, 8], [-2, 0, 8], [3, 0, 8]] },
            { taskType: 'inspect', route: [[5, 0, 1], [8, 0, 1], [11, 0, 1]] },
            { taskType: 'sort', route: [[3, 0, 6], [6, 0, 6], [9, 0, 6]] },
        ],
    }

    return profilesByRoom[roomId] ?? profilesByRoom.receiving
}

function getAreaObstacles(areaId) {
    const obstaclesByArea = {
        hub: [
            { minX: -13.8, maxX: -2.2, minZ: 1, maxZ: 3.1 },
            { minX: 8.9, maxX: 11.1, minZ: 5.2, maxZ: 6.8 },
            { minX: 11.9, maxX: 14.1, minZ: 5.2, maxZ: 6.8 },
            { minX: 7.2, maxX: 10.8, minZ: -3.9, maxZ: -0.1 },
            { minX: -15.7, maxX: -8.3, minZ: 8, maxZ: 10 },
            { minX: 1.4, maxX: 2.6, minZ: 4.4, maxZ: 5.6 },
            { minX: 3.2, maxX: 4.8, minZ: 3.7, maxZ: 5.3 },
        ],
        receiving: [
            { minX: -8.7, maxX: 4.7, minZ: -4.9, maxZ: -3.1 },
            { minX: -10.9, maxX: -9.1, minZ: 5.3, maxZ: 6.7 },
            { minX: -6.9, maxX: -5.1, minZ: 5.3, maxZ: 6.7 },
            { minX: 7.2, maxX: 10.8, minZ: 3.1, maxZ: 6.9 },
            { minX: 4.4, maxX: 5.6, minZ: 1.4, maxZ: 2.6 },
            { minX: 6.4, maxX: 7.6, minZ: 0.4, maxZ: 1.6 },
            { minX: 6.7, maxX: 13.3, minZ: -7.9, maxZ: -6.1 },
        ],
        packing: [
            { minX: -10.3, maxX: 0.3, minZ: -3.9, maxZ: -2.1 },
            { minX: 3, maxX: 11, minZ: 2.1, maxZ: 3.9 },
            { minX: 6, maxX: 10, minZ: -6.9, maxZ: -5.1 },
            { minX: -13.7, maxX: -6.3, minZ: 5, maxZ: 7 },
            { minX: 0.4, maxX: 1.6, minZ: 5.4, maxZ: 6.6 },
            { minX: 2.3, maxX: 3.7, minZ: 5.3, maxZ: 6.7 },
        ],
        cold: [
            { minX: -11.4, maxX: -6.6, minZ: -5.3, maxZ: -2.7 },
            { minX: -2.4, maxX: 2.4, minZ: -5.3, maxZ: -2.7 },
            { minX: 6.6, maxX: 11.4, minZ: -5.3, maxZ: -2.7 },
            { minX: 3.1, maxX: 8.9, minZ: 4.1, maxZ: 5.9 },
            { minX: -8.6, maxX: -7.4, minZ: 6.4, maxZ: 7.6 },
            { minX: -7.4, maxX: -6.2, minZ: 6.4, maxZ: 7.6 },
        ],
        maintenance: [
            { minX: -10, maxX: -6, minZ: -5.9, maxZ: -4.1 },
            { minX: 3, maxX: 7, minZ: 3.1, maxZ: 4.9 },
            { minX: 8.2, maxX: 11.8, minZ: -7.9, maxZ: -4.1 },
            { minX: -12.3, maxX: -5.7, minZ: 6, maxZ: 8 },
            { minX: 0.2, maxX: 1.8, minZ: -2.8, maxZ: -1.2 },
            { minX: 2.8, maxX: 4.2, minZ: 6.2, maxZ: 7.8 },
        ],
        quality: [
            { minX: -10.9, maxX: -5.1, minZ: -4.9, maxZ: -3.1 },
            { minX: 2.1, maxX: 7.9, minZ: 1.1, maxZ: 2.9 },
            { minX: 6.7, maxX: 13.3, minZ: 6, maxZ: 8 },
            { minX: -2.8, maxX: -1.2, minZ: 6.2, maxZ: 7.8 },
            { minX: -0.8, maxX: 0.8, minZ: 6.2, maxZ: 7.8 },
        ],
        dispatch: [
            { minX: -10.2, maxX: 2.2, minZ: -1.9, maxZ: -0.1 },
            { minX: 6.9, maxX: 9.1, minZ: 5.2, maxZ: 6.8 },
            { minX: 10.9, maxX: 13.1, minZ: 5.2, maxZ: 6.8 },
            { minX: 8.2, maxX: 11.8, minZ: -8.9, maxZ: -5.1 },
            { minX: -13.7, maxX: -6.3, minZ: 6, maxZ: 8 },
            { minX: 3.1, maxX: 4.9, minZ: 4.1, maxZ: 5.9 },
        ],
    }

    return obstaclesByArea[areaId] ?? []
}

export default function App() {
    const [lightingMode, setLightingMode] = useState('full')
    const [speed, setSpeed] = useState(1)
    const [workerCount, setWorkerCount] = useState(8)
    const [roomCount, setRoomCount] = useState(4)
    const [selectedRoomIndex, setSelectedRoomIndex] = useState(null)
    const [transitionState, setTransitionState] = useState(null)
    const [fireAreas, setFireAreas] = useState({})
    const [ladderFallState, setLadderFallState] = useState({ trigger: 0, areaId: null })
    const [incidentNotifications, setIncidentNotifications] = useState([])
    const [incidentAlarm, setIncidentAlarm] = useState(null)
    const [complianceTargets, setComplianceTargets] = useState({
        helmet: 100,
        vest: 100,
        gloves: 100,
    })
    const currentArea = selectedRoomIndex === null ? HUB_AREA : ROOM_LIBRARY[selectedRoomIndex]

    useEffect(() => {
        if (selectedRoomIndex !== null && selectedRoomIndex >= roomCount) {
            setSelectedRoomIndex(null)
        }
    }, [selectedRoomIndex, roomCount])

    useEffect(() => {
        if (!ladderFallState.trigger) {
            return undefined
        }

        const timeoutId = window.setTimeout(() => {
            setLadderFallState((prev) =>
                prev.trigger === ladderFallState.trigger ? { trigger: 0, areaId: null } : prev
            )
        }, 3200)

        return () => window.clearTimeout(timeoutId)
    }, [ladderFallState])

    useEffect(() => {
        if (incidentNotifications.length === 0) {
            return undefined
        }

        const timeoutId = window.setTimeout(() => {
            setIncidentNotifications((prev) => prev.slice(1))
        }, 5600)

        return () => window.clearTimeout(timeoutId)
    }, [incidentNotifications])

    useEffect(() => {
        if (!incidentAlarm) {
            return undefined
        }

        const timeoutId = window.setTimeout(() => {
            setIncidentAlarm(null)
        }, 6800)

        return () => window.clearTimeout(timeoutId)
    }, [incidentAlarm])

    // Generate worker list based on count + current area + per-compliance targets.
    const workers = useMemo(() => {
        const roomProfiles = getRoomWorkerProfiles(currentArea.id)
        const obstacles = getAreaObstacles(currentArea.id)
        const workerIndexes = Array.from({ length: workerCount }, (_, index) => index)
        const complianceAssignments = Object.fromEntries(
            PPE_ITEMS.map(({ key }) => {
                const requiredCount = Math.round((workerCount * complianceTargets[key]) / 100)
                const assignedWorkers = new Set(
                    [...workerIndexes]
                        .sort((a, b) => getAssignmentScore(a, key) - getAssignmentScore(b, key))
                        .slice(0, requiredCount)
                )

                return [key, assignedWorkers]
            })
        )

        return Array.from({ length: workerCount }, (_, i) => ({
            ...roomProfiles[i % roomProfiles.length],
            id: `P${i + 1}`,
            obstacles,
            ppeConfig: Object.fromEntries(
                PPE_ITEMS.map(({ key }) => [key, complianceAssignments[key].has(i)])
            ),
        }))
    }, [workerCount, complianceTargets, currentArea.id])

    const complianceSummary = useMemo(() => {
        return PPE_ITEMS.map(({ key, label }) => {
            const count = workers.filter((worker) => worker.ppeConfig[key]).length
            const percent = workerCount ? Math.round((count / workerCount) * 100) : 0

            return {
                key,
                label,
                count,
                percent,
            }
        })
    }, [workerCount, workers])

    const showSceneLabels = true
    const fireActive = Boolean(fireAreas[currentArea.id])
    const ladderActive = ladderFallState.areaId === currentArea.id && ladderFallState.trigger > 0
    const panicActive = fireActive || ladderActive
    const incidentSource = fireActive
        ? INCIDENT_SOURCES[currentArea.id]?.fire ?? INCIDENT_SOURCES.hub.fire
        : ladderActive
            ? INCIDENT_SOURCES[currentArea.id]?.ladder ?? INCIDENT_SOURCES.hub.ladder
            : null
    const startTransitionToArea = (targetLabel, onMidpoint) => {
        if (transitionState) {
            return
        }

        setTransitionState({
            targetRoomName: targetLabel,
        })

        window.setTimeout(() => {
            onMidpoint()
        }, 360)

        window.setTimeout(() => {
            setTransitionState(null)
        }, 980)
    }

    const handleEnterRoom = (targetRoomIndex) => {
        if (
            targetRoomIndex < 0 ||
            targetRoomIndex >= roomCount ||
            targetRoomIndex === selectedRoomIndex
        ) {
            return
        }

        startTransitionToArea(ROOM_LIBRARY[targetRoomIndex].name, () => {
            setSelectedRoomIndex(targetRoomIndex)
        })
    }

    const handleReturnToHub = () => {
        if (selectedRoomIndex === null) {
            return
        }

        startTransitionToArea(HUB_AREA.name, () => {
            setSelectedRoomIndex(null)
        })
    }

    const pushIncidentNotification = (title, message, tone = 'info') => {
        const notification = buildIncidentNotification(`${Date.now()}-${Math.random()}`, title, message, tone)
        setIncidentNotifications((prev) => [...prev.slice(-2), notification])
    }

    const sendIncidentWebhook = async ({ eventType, severity, details, location, responderLabel }) => {
        pushIncidentNotification(
            `${responderLabel} Pending`,
            `Incident sent for ${location}. Waiting for n8n mail confirmation...`,
            'info'
        )

        try {
            const response = await fetch(INCIDENT_WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    event_type: eventType,
                    severity,
                    details,
                    location,
                    responder: responderLabel,
                }),
            })

            if (!response.ok) {
                throw new Error(`Webhook failed with status ${response.status}`)
            }

            let responseMessage = ''
            try {
                const payload = await response.clone().json()
                responseMessage = payload?.message ?? payload?.status ?? ''
            } catch {
                try {
                    responseMessage = await response.text()
                } catch {
                    responseMessage = ''
                }
            }

            const confirmedMessage = responseMessage
                ? `${responderLabel} notified for ${location}. ${responseMessage}`
                : `${responderLabel} has been notified for ${location} after n8n completed the mail step.`

            pushIncidentNotification(
                `${responderLabel} Notified`,
                confirmedMessage,
                'success'
            )
            setIncidentAlarm({
                responderLabel,
                location,
                message: confirmedMessage,
            })
        } catch (error) {
            pushIncidentNotification(
                'Webhook Error',
                error.message || 'Unable to reach incident workflow.',
                'error'
            )
        }
    }

    const handleStartFire = () => {
        setFireAreas((prev) => ({
            ...prev,
            [currentArea.id]: true,
        }))
        void sendIncidentWebhook({
            eventType: 'fire',
            severity: 'high',
            details: {
                injury_type: 'fire',
                fire_detected: true,
                violence_detected: false,
            },
            location: currentArea.name,
            responderLabel: 'Fire Brigade',
        })
    }

    const handleTriggerLadderFall = () => {
        setLadderFallState({
            trigger: Date.now(),
            areaId: currentArea.id,
        })
        void sendIncidentWebhook({
            eventType: 'accident',
            severity: 'high',
            details: {
                injury_type: 'fall',
                fire_detected: false,
                violence_detected: false,
            },
            location: currentArea.name,
            responderLabel: 'Ambulance',
        })
    }

    return (
        <div className="w-full h-full relative" style={{ background: 'linear-gradient(180deg, #dce4eb 0%, #c6d1dc 100%)' }}>
            {/* 3D Canvas */}
            <Canvas
                dpr={[1, 1.25]}
                shadows
                gl={{ antialias: false, alpha: false }}
                camera={{ fov: 50, near: 0.1, far: 200 }}
                style={{ position: 'absolute', inset: 0 }}
            >
                <Scene
                    lightingMode={lightingMode}
                    speed={speed}
                    roomCount={roomCount}
                    selectedRoomIndex={selectedRoomIndex}
                    currentArea={currentArea}
                    roomOptions={ROOM_LIBRARY.slice(0, roomCount)}
                    onEnterRoom={handleEnterRoom}
                    onReturnToHub={handleReturnToHub}
                    showLabels={showSceneLabels}
                    fireActive={fireActive}
                    ladderFallTrigger={ladderActive ? ladderFallState.trigger : 0}
                />

                {workers.map((w) => (
                    <Worker
                        key={`${currentArea.id}-${w.id}`}
                        id={w.id}
                        route={w.route}
                        speed={speed}
                        taskType={w.taskType}
                        workerIndex={Number(w.id.slice(1)) - 1}
                        obstacles={w.obstacles}
                        ppeConfig={w.ppeConfig}
                        showLabel={showSceneLabels}
                        panicActive={panicActive}
                        incidentSource={incidentSource}
                    />
                ))}
            </Canvas>

            {incidentNotifications.length ? (
                <div className="incident-toast-stack pointer-events-none">
                    {incidentNotifications.map((notification) => (
                        <div
                            key={notification.id}
                            className={`incident-toast slide-in ${
                                notification.tone === 'success'
                                    ? 'incident-toast-success'
                                    : notification.tone === 'error'
                                        ? 'incident-toast-error'
                                        : 'incident-toast-info'
                            }`}
                        >
                            <p className="incident-toast-title">{notification.title}</p>
                            <p className="incident-toast-message">{notification.message}</p>
                        </div>
                    ))}
                </div>
            ) : null}

            {incidentAlarm ? (
                <div className="incident-banner-wrap pointer-events-none">
                    <div className="incident-banner">
                        <p className="incident-banner-eyebrow">
                            Emergency Notification Confirmed
                        </p>
                        <p className="incident-banner-title">
                            {incidentAlarm.responderLabel} notified for {incidentAlarm.location}
                        </p>
                        <p className="incident-banner-message">
                            {incidentAlarm.message}
                        </p>
                    </div>
                </div>
            ) : null}

            {/* UI Overlay */}
            <Controls
                lightingMode={lightingMode}
                setLightingMode={setLightingMode}
                speed={speed}
                setSpeed={setSpeed}
                workerCount={workerCount}
                setWorkerCount={setWorkerCount}
                roomCount={roomCount}
                setRoomCount={setRoomCount}
                currentRoomName={currentArea.name}
                complianceTargets={complianceTargets}
                setComplianceTargets={setComplianceTargets}
                onStartFire={handleStartFire}
                onTriggerLadderFall={handleTriggerLadderFall}
                fireActive={fireActive}
                ladderActive={ladderActive}
            />

            <div className={`room-transition-overlay ${transitionState ? 'active' : ''}`}>
                {transitionState && (
                    <div className="room-transition-card">
                        <span className="room-transition-eyebrow">Entering</span>
                        <span className="room-transition-title">{transitionState.targetRoomName}</span>
                    </div>
                )}
            </div>

            {/* Bottom status bar */}
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
                <div className="glass rounded-full px-5 py-2 flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-gray-300 text-[11px] font-medium">
                            {workerCount} Workers Active
                        </span>
                    </div>
                    <div className="w-px h-4 bg-gray-600/50" />
                    <span className="text-gray-400 text-[11px]">
                        PPE: {complianceSummary
                            .map(({ label, count, percent }) => `${label} ${count}/${workerCount} (${percent}%)`)
                            .join(' • ')}
                    </span>
                    <div className="w-px h-4 bg-gray-600/50" />
                    <span className="text-gray-400 text-[11px]">
                        View: {currentArea.name}{selectedRoomIndex === null ? '' : ` (${selectedRoomIndex + 1}/${roomCount})`}
                    </span>
                    <div className="w-px h-4 bg-gray-600/50" />
                    <span className="text-gray-500 text-[10px]">
                        Speed: {speed}×
                    </span>
                </div>
            </div>
        </div>
    )
}

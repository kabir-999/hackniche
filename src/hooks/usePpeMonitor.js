import { useEffect, useMemo, useRef, useState } from 'react'

const DEFAULT_BACKEND_URL = 'ws://127.0.0.1:8000/ws/ppe'
const CAPTURE_INTERVAL_MS = 90
const CAPTURE_MAX_WIDTH = 640
const CAPTURE_JPEG_QUALITY = 0.58

function workerSeverity(worker) {
    if (worker.compliant) return 0
    return worker.violations.includes('helmet') ? 2 : 1
}

export default function usePpeMonitor({ renderCanvas }) {
    const [enabled, setEnabled] = useState(false)
    const [connectionState, setConnectionState] = useState('idle')
    const [error, setError] = useState('')
    const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL)
    const [previewSrc, setPreviewSrc] = useState('')
    const [depthPreviewSrc, setDepthPreviewSrc] = useState('')
    const [depthStats, setDepthStats] = useState(null)
    const [frameRate, setFrameRate] = useState(0)
    const [lastResult, setLastResult] = useState(null)
    const [backendWorkerCount, setBackendWorkerCount] = useState(0)
    const [backendDetectionCount, setBackendDetectionCount] = useState(0)
    const [backendPersonCount, setBackendPersonCount] = useState(0)
    const [backendPpeCount, setBackendPpeCount] = useState(0)

    const socketRef = useRef(null)
    const intervalRef = useRef(null)
    const pendingFrameRef = useRef(false)
    const resultsCounterRef = useRef({ count: 0, lastTick: performance.now() })
    const captureCanvasRef = useRef(null)

    const workers = useMemo(
        () => [...(lastResult?.workers ?? [])].sort(
            (a, b) => workerSeverity(b) - workerSeverity(a) || a.track_id - b.track_id
        ),
        [lastResult]
    )
    const alerts = lastResult?.alerts ?? []

    useEffect(() => {
        return () => {
            stopMonitoring()
        }
    }, [])

    const stopMonitoring = () => {
        if (intervalRef.current) {
            window.clearInterval(intervalRef.current)
            intervalRef.current = null
        }

        pendingFrameRef.current = false

        if (socketRef.current) {
            socketRef.current.close()
            socketRef.current = null
        }

        setEnabled(false)
        setConnectionState('idle')
        setPreviewSrc('')
        setDepthPreviewSrc('')
        setDepthStats(null)
        setFrameRate(0)
        setLastResult(null)
        setBackendWorkerCount(0)
        setBackendDetectionCount(0)
        setBackendPersonCount(0)
        setBackendPpeCount(0)
    }

    const startMonitoring = async () => {
        if (enabled) return
        if (!renderCanvas) {
            setConnectionState('error')
            setError('Three.js canvas is not ready yet. Wait a moment and try again.')
            return
        }

        setError('')
        setConnectionState('connecting')

        const socket = new WebSocket(backendUrl)
        socket.binaryType = 'arraybuffer'
        socketRef.current = socket

        socket.onopen = () => {
            setEnabled(true)
            setConnectionState('connected')
            resultsCounterRef.current = { count: 0, lastTick: performance.now() }
            intervalRef.current = window.setInterval(captureAndSendFrame, CAPTURE_INTERVAL_MS)
        }

        socket.onmessage = (event) => {
            const payload = JSON.parse(event.data)
            if (payload.type === 'ready') {
                setConnectionState('connected')
                return
            }

            if (payload.type === 'error') {
                setError(payload.message || 'Backend processing error.')
                pendingFrameRef.current = false
                return
            }

            if (payload.type === 'frame_result') {
                pendingFrameRef.current = false
                setPreviewSrc(payload.preview || '')
                setDepthPreviewSrc(payload.depth?.preview || '')
                setDepthStats(payload.depth || null)
                setLastResult(payload.result ?? null)
                setBackendWorkerCount(payload.result?.workers?.length ?? 0)
                setBackendDetectionCount(payload.result?.detections?.length ?? 0)
                setBackendPersonCount(
                    (payload.result?.detections ?? []).filter((detection) => detection.canonical_label === 'person').length
                )
                setBackendPpeCount(
                    (payload.result?.detections ?? []).filter((detection) => detection.canonical_label !== 'person').length
                )

                const tracker = resultsCounterRef.current
                tracker.count += 1
                const now = performance.now()
                if (now - tracker.lastTick >= 1000) {
                    setFrameRate(Math.round((tracker.count * 1000) / (now - tracker.lastTick)))
                    tracker.count = 0
                    tracker.lastTick = now
                }
            }
        }

        socket.onerror = () => {
            setConnectionState('error')
            setError('Unable to connect to PPE backend. Start `python3 run_ppe_server.py --model best.pt` first.')
        }

        socket.onclose = () => {
            if (intervalRef.current) {
                window.clearInterval(intervalRef.current)
                intervalRef.current = null
            }
            pendingFrameRef.current = false
            setEnabled(false)
            setConnectionState('disconnected')
        }
    }

    const captureAndSendFrame = () => {
        const socket = socketRef.current
        if (!socket || socket.readyState !== WebSocket.OPEN || !renderCanvas) {
            return
        }
        if (pendingFrameRef.current) {
            return
        }

        pendingFrameRef.current = true
        const sourceWidth = renderCanvas.width || renderCanvas.clientWidth || renderCanvas.offsetWidth
        const sourceHeight = renderCanvas.height || renderCanvas.clientHeight || renderCanvas.offsetHeight
        if (!sourceWidth || !sourceHeight) {
            pendingFrameRef.current = false
            return
        }

        const scale = Math.min(1, CAPTURE_MAX_WIDTH / sourceWidth)
        const targetWidth = Math.max(1, Math.round(sourceWidth * scale))
        const targetHeight = Math.max(1, Math.round(sourceHeight * scale))
        const captureCanvas = captureCanvasRef.current ?? document.createElement('canvas')
        captureCanvasRef.current = captureCanvas
        captureCanvas.width = targetWidth
        captureCanvas.height = targetHeight

        const context = captureCanvas.getContext('2d', { alpha: false, willReadFrequently: false })
        if (!context) {
            pendingFrameRef.current = false
            return
        }

        context.drawImage(renderCanvas, 0, 0, targetWidth, targetHeight)

        captureCanvas.toBlob(async (blob) => {
            if (!blob || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
                pendingFrameRef.current = false
                return
            }

            try {
                const buffer = await blob.arrayBuffer()
                socketRef.current.send(buffer)
            } catch (err) {
                pendingFrameRef.current = false
                setError(err.message || 'Unable to send Three.js frame to backend.')
            }
        }, 'image/jpeg', CAPTURE_JPEG_QUALITY)
    }

    return {
        enabled,
        connectionState,
        error,
        backendUrl,
        setBackendUrl,
        frameRate,
        previewSrc,
        depthPreviewSrc,
        depthStats,
        workers,
        alerts,
        backendWorkerCount,
        backendDetectionCount,
        backendPersonCount,
        backendPpeCount,
        startMonitoring,
        stopMonitoring,
    }
}

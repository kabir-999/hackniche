import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'

const VEST_COLORS = ['#39ff14']
const HELMET_COLORS = ['#facc15']
const GLOVE_COLORS = ['#4a4a4a', '#e65100', '#1b5e20']
const SKIN_TONES = ['#d4a574', '#c49a6c', '#8d5524', '#6b3a2a', '#f5c6a0']
const TASK_SPEEDS = {
    patrol: 1.1,
    inspect: 0.95,
    sort: 0.9,
    carry: 1.25,
    lift: 0.85,
}
const TASK_PAUSES = {
    patrol: 0.4,
    inspect: 1.6,
    sort: 1.8,
    carry: 0.9,
    lift: 2.1,
}
const OBSTACLE_CLEARANCE = 1.55
const QR_GRID_SIZE = 21
const GRID_CELL_SIZE = 0.45

function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)]
}

function toVector(point) {
    return new THREE.Vector3(point[0], point[1], point[2])
}

function hashString(value) {
    let hash = 2166136261

    for (const char of value) {
        hash ^= char.charCodeAt(0)
        hash = Math.imul(hash, 16777619)
    }

    return hash >>> 0
}

function drawFinderPattern(ctx, x, y, cellSize, offsetX, offsetY) {
    const layers = [
        { offset: 0, size: 7, color: '#000000' },
        { offset: 1, size: 5, color: '#ffffff' },
        { offset: 2, size: 3, color: '#000000' },
    ]

    layers.forEach(({ offset, size, color }) => {
        ctx.fillStyle = color
        ctx.fillRect(
            offsetX + (x + offset) * cellSize,
            offsetY + (y + offset) * cellSize,
            size * cellSize,
            size * cellSize
        )
    })
}

function createQrBadgeTexture(workerId) {
    const canvas = document.createElement('canvas')
    const size = 256
    const margin = 20
    const labelHeight = 34
    const matrixPixels = size - margin * 2 - labelHeight
    const cellSize = Math.floor(matrixPixels / QR_GRID_SIZE)
    const actualMatrixSize = cellSize * QR_GRID_SIZE
    const offsetX = Math.floor((size - actualMatrixSize) / 2)
    const offsetY = margin
    const hash = hashString(`worker:${workerId}`)
    const reserved = new Set()
    const ctx = canvas.getContext('2d')

    canvas.width = size
    canvas.height = size

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)

    const markReservedSquare = (startX, startY) => {
        for (let y = startY; y < startY + 7; y += 1) {
            for (let x = startX; x < startX + 7; x += 1) {
                reserved.add(`${x},${y}`)
            }
        }
    }

    markReservedSquare(0, 0)
    markReservedSquare(QR_GRID_SIZE - 7, 0)
    markReservedSquare(0, QR_GRID_SIZE - 7)

    drawFinderPattern(ctx, 0, 0, cellSize, offsetX, offsetY)
    drawFinderPattern(ctx, QR_GRID_SIZE - 7, 0, cellSize, offsetX, offsetY)
    drawFinderPattern(ctx, 0, QR_GRID_SIZE - 7, cellSize, offsetX, offsetY)

    for (let y = 0; y < QR_GRID_SIZE; y += 1) {
        for (let x = 0; x < QR_GRID_SIZE; x += 1) {
            if (reserved.has(`${x},${y}`)) {
                continue
            }

            const bit = ((hash >> ((x * 5 + y * 3) % 32)) & 1) ^ ((x + y) % 2)

            if (bit) {
                ctx.fillStyle = '#000000'
                ctx.fillRect(offsetX + x * cellSize, offsetY + y * cellSize, cellSize, cellSize)
            }
        }
    }

    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 6
    ctx.strokeRect(offsetX - 8, offsetY - 8, actualMatrixSize + 16, actualMatrixSize + 16)

    ctx.fillStyle = '#111827'
    ctx.font = 'bold 22px Inter, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(workerId, size / 2, size - 10)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    return texture
}

function almostSamePoint(a, b) {
    return a.distanceToSquared(b) < 0.04
}

function pointInsideRect(point, rect) {
    return (
        point.x >= rect.minX &&
        point.x <= rect.maxX &&
        point.z >= rect.minZ &&
        point.z <= rect.maxZ
    )
}

function orientation(a, b, c) {
    const value = (b.z - a.z) * (c.x - b.x) - (b.x - a.x) * (c.z - b.z)

    if (Math.abs(value) < 1e-6) return 0
    return value > 0 ? 1 : 2
}

function onSegment(a, b, c) {
    return (
        Math.min(a.x, c.x) <= b.x &&
        b.x <= Math.max(a.x, c.x) &&
        Math.min(a.z, c.z) <= b.z &&
        b.z <= Math.max(a.z, c.z)
    )
}

function segmentsIntersect(a, b, c, d) {
    const o1 = orientation(a, b, c)
    const o2 = orientation(a, b, d)
    const o3 = orientation(c, d, a)
    const o4 = orientation(c, d, b)

    if (o1 !== o2 && o3 !== o4) return true
    if (o1 === 0 && onSegment(a, c, b)) return true
    if (o2 === 0 && onSegment(a, d, b)) return true
    if (o3 === 0 && onSegment(c, a, d)) return true
    if (o4 === 0 && onSegment(c, b, d)) return true
    return false
}

function expandObstacle(obstacle, margin) {
    return {
        minX: obstacle.minX - margin,
        maxX: obstacle.maxX + margin,
        minZ: obstacle.minZ - margin,
        maxZ: obstacle.maxZ + margin,
    }
}

function segmentIntersectsRect(start, end, rect) {
    if (pointInsideRect(start, rect) || pointInsideRect(end, rect)) {
        return true
    }

    const topLeft = new THREE.Vector3(rect.minX, 0, rect.minZ)
    const topRight = new THREE.Vector3(rect.maxX, 0, rect.minZ)
    const bottomLeft = new THREE.Vector3(rect.minX, 0, rect.maxZ)
    const bottomRight = new THREE.Vector3(rect.maxX, 0, rect.maxZ)

    return (
        segmentsIntersect(start, end, topLeft, topRight) ||
        segmentsIntersect(start, end, topRight, bottomRight) ||
        segmentsIntersect(start, end, bottomRight, bottomLeft) ||
        segmentsIntersect(start, end, bottomLeft, topLeft)
    )
}

function sanitizePoints(points) {
    return points.filter((point, index) => {
        if (index === 0) return true
        return !almostSamePoint(point, points[index - 1])
    })
}

function isPointBlocked(point, obstacles, margin = OBSTACLE_CLEARANCE) {
    return obstacles.some((obstacle) => pointInsideRect(point, expandObstacle(obstacle, margin)))
}

function keyForCell(cell) {
    return `${cell.x},${cell.z}`
}

function deriveBounds(points, obstacles) {
    const xs = points.map((point) => point.x)
    const zs = points.map((point) => point.z)

    obstacles.forEach((obstacle) => {
        xs.push(obstacle.minX, obstacle.maxX)
        zs.push(obstacle.minZ, obstacle.maxZ)
    })

    return {
        minX: Math.min(...xs) - 2,
        maxX: Math.max(...xs) + 2,
        minZ: Math.min(...zs) - 2,
        maxZ: Math.max(...zs) + 2,
    }
}

function toCell(point, bounds) {
    return {
        x: Math.round((point.x - bounds.minX) / GRID_CELL_SIZE),
        z: Math.round((point.z - bounds.minZ) / GRID_CELL_SIZE),
    }
}

function toWorld(cell, bounds) {
    return new THREE.Vector3(
        bounds.minX + cell.x * GRID_CELL_SIZE,
        0,
        bounds.minZ + cell.z * GRID_CELL_SIZE
    )
}

function buildBlockedCells(bounds, obstacles) {
    const blocked = new Set()

    obstacles.forEach((obstacle) => {
        const expanded = expandObstacle(obstacle, OBSTACLE_CLEARANCE)
        const minCellX = Math.floor((expanded.minX - bounds.minX) / GRID_CELL_SIZE)
        const maxCellX = Math.ceil((expanded.maxX - bounds.minX) / GRID_CELL_SIZE)
        const minCellZ = Math.floor((expanded.minZ - bounds.minZ) / GRID_CELL_SIZE)
        const maxCellZ = Math.ceil((expanded.maxZ - bounds.minZ) / GRID_CELL_SIZE)

        for (let x = minCellX; x <= maxCellX; x += 1) {
            for (let z = minCellZ; z <= maxCellZ; z += 1) {
                blocked.add(keyForCell({ x, z }))
            }
        }
    })

    return blocked
}

function findNearestFreeCell(startCell, blocked, bounds) {
    const queue = [startCell]
    const visited = new Set([keyForCell(startCell)])
    const maxRadius = Math.ceil(
        Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / GRID_CELL_SIZE
    )

    while (queue.length) {
        const cell = queue.shift()

        if (!blocked.has(keyForCell(cell))) {
            return cell
        }

        const neighbors = [
            { x: cell.x + 1, z: cell.z },
            { x: cell.x - 1, z: cell.z },
            { x: cell.x, z: cell.z + 1 },
            { x: cell.x, z: cell.z - 1 },
            { x: cell.x + 1, z: cell.z + 1 },
            { x: cell.x + 1, z: cell.z - 1 },
            { x: cell.x - 1, z: cell.z + 1 },
            { x: cell.x - 1, z: cell.z - 1 },
        ]

        neighbors.forEach((neighbor) => {
            const key = keyForCell(neighbor)

            if (
                !visited.has(key) &&
                Math.abs(neighbor.x - startCell.x) <= maxRadius &&
                Math.abs(neighbor.z - startCell.z) <= maxRadius
            ) {
                visited.add(key)
                queue.push(neighbor)
            }
        })
    }

    return startCell
}

function heuristic(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z)
}

function reconstructCellPath(cameFrom, current) {
    const path = [current]
    let cursor = current

    while (cameFrom.has(keyForCell(cursor))) {
        cursor = cameFrom.get(keyForCell(cursor))
        path.push(cursor)
    }

    return path.reverse()
}

function findGridPath(start, end, blocked, bounds, obstacles) {
    const rawStartCell = toCell(start, bounds)
    const rawEndCell = toCell(end, bounds)
    const startCell = findNearestFreeCell(rawStartCell, blocked, bounds)
    const endCell = findNearestFreeCell(rawEndCell, blocked, bounds)
    const open = [startCell]
    const cameFrom = new Map()
    const gScore = new Map([[keyForCell(startCell), 0]])
    const fScore = new Map([[keyForCell(startCell), heuristic(startCell, endCell)]])
    const seen = new Set([keyForCell(startCell)])

    while (open.length) {
        open.sort((a, b) => (fScore.get(keyForCell(a)) ?? Infinity) - (fScore.get(keyForCell(b)) ?? Infinity))
        const current = open.shift()
        const currentKey = keyForCell(current)

        if (current.x === endCell.x && current.z === endCell.z) {
            const cellPath = reconstructCellPath(cameFrom, current)
            const worldPath = cellPath.map((cell) => toWorld(cell, bounds))
            worldPath[0] = toWorld(startCell, bounds)
            worldPath[worldPath.length - 1] = toWorld(endCell, bounds)
            return worldPath
        }

        const neighbors = [
            { x: current.x + 1, z: current.z, cost: 1 },
            { x: current.x - 1, z: current.z, cost: 1 },
            { x: current.x, z: current.z + 1, cost: 1 },
            { x: current.x, z: current.z - 1, cost: 1 },
            { x: current.x + 1, z: current.z + 1, cost: Math.SQRT2 },
            { x: current.x + 1, z: current.z - 1, cost: Math.SQRT2 },
            { x: current.x - 1, z: current.z + 1, cost: Math.SQRT2 },
            { x: current.x - 1, z: current.z - 1, cost: Math.SQRT2 },
        ]

        neighbors.forEach((neighbor) => {
            const neighborKey = keyForCell(neighbor)
            const worldNeighbor = toWorld(neighbor, bounds)
            const stepX = neighbor.x - current.x
            const stepZ = neighbor.z - current.z

            if (
                Math.abs(stepX) === 1 &&
                Math.abs(stepZ) === 1 &&
                (blocked.has(keyForCell({ x: current.x + stepX, z: current.z })) ||
                    blocked.has(keyForCell({ x: current.x, z: current.z + stepZ })))
            ) {
                return
            }

            if (
                blocked.has(neighborKey) ||
                obstacles.some((obstacle) => pointInsideRect(worldNeighbor, expandObstacle(obstacle, OBSTACLE_CLEARANCE)))
            ) {
                return
            }

            const tentativeG = (gScore.get(currentKey) ?? Infinity) + neighbor.cost

            if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
                cameFrom.set(neighborKey, current)
                gScore.set(neighborKey, tentativeG)
                fScore.set(neighborKey, tentativeG + heuristic(neighbor, endCell))

                if (!seen.has(neighborKey)) {
                    seen.add(neighborKey)
                    open.push(neighbor)
                }
            }
        })
    }

    return [start.clone(), end.clone()]
}
function createNavigablePath(route, obstacles) {
    const points = route.map(toVector)

    if (points.length <= 1 || !obstacles?.length) {
        return points
    }

    const bounds = deriveBounds(points, obstacles)
    const blocked = buildBlockedCells(bounds, obstacles)
    let path = [points[0]]

    for (let i = 1; i < points.length; i += 1) {
        const segmentPath = findGridPath(path[path.length - 1], points[i], blocked, bounds, obstacles)
        path = [...path, ...segmentPath.slice(1)]
    }

    return sanitizePoints(path)
}

function pickPanicTargets(route, obstacles, incidentSource, workerIndex) {
    const routePoints = route.map(toVector)
    const incidentPoint = toVector(incidentSource)
    const bounds = deriveBounds(routePoints.length ? routePoints : [incidentPoint], obstacles)
    const candidates = [
        new THREE.Vector3(bounds.minX + 2.2, 0, bounds.minZ + 2.2),
        new THREE.Vector3(bounds.maxX - 2.2, 0, bounds.minZ + 2.2),
        new THREE.Vector3(bounds.minX + 2.2, 0, bounds.maxZ - 2.2),
        new THREE.Vector3(bounds.maxX - 2.2, 0, bounds.maxZ - 2.2),
        new THREE.Vector3(bounds.minX + 2.2, 0, 0),
        new THREE.Vector3(bounds.maxX - 2.2, 0, 0),
        new THREE.Vector3(0, 0, bounds.minZ + 2.2),
        new THREE.Vector3(0, 0, bounds.maxZ - 2.2),
    ]
        .filter((point) => !isPointBlocked(point, obstacles))
        .sort((a, b) => b.distanceToSquared(incidentPoint) - a.distanceToSquared(incidentPoint))

    if (!candidates.length) {
        return route
    }

    const offset = workerIndex % candidates.length
    return Array.from({ length: Math.min(4, candidates.length) }, (_, index) => {
        const point = candidates[(offset + index) % candidates.length]
        return [point.x, 0, point.z]
    })
}

function pathSegmentBlocked(start, end, obstacles) {
    return obstacles.some((obstacle) =>
        segmentIntersectsRect(start, end, expandObstacle(obstacle, OBSTACLE_CLEARANCE))
    )
}

export default function Worker({
    id,
    route,
    speed = 1,
    taskType = 'patrol',
    workerIndex = 0,
    obstacles = [],
    ppeConfig,
    showLabel = true,
    panicActive = false,
    incidentSource = null,
}) {
    const group = useRef()
    const leftArm = useRef()
    const rightArm = useRef()
    const leftLeg = useRef()
    const rightLeg = useRef()
    const bodyBob = useRef()
    const carriedLoad = useRef()

    const skinTone = useMemo(() => randomFrom(SKIN_TONES), [])
    const helmetColor = useMemo(() => randomFrom(HELMET_COLORS), [])
    const vestColor = useMemo(() => randomFrom(VEST_COLORS), [])
    const gloveColor = useMemo(() => randomFrom(GLOVE_COLORS), [])
    const qrBadgeTexture = useMemo(() => createQrBadgeTexture(id), [id])
    const normalPath = useMemo(() => createNavigablePath(route, obstacles), [route, obstacles])
    const panicRoute = useMemo(() => {
        if (!panicActive || !incidentSource) {
            return route
        }
        return pickPanicTargets(route, obstacles, incidentSource, workerIndex)
    }, [panicActive, incidentSource, obstacles, route, workerIndex])
    const panicPath = useMemo(() => createNavigablePath(panicRoute, obstacles), [panicRoute, obstacles])
    const activePath = panicActive ? panicPath : normalPath
    const phaseOffset = useMemo(() => workerIndex * 0.47, [workerIndex])
    const baseMoveSpeed = useMemo(
        () => TASK_SPEEDS[taskType] * (0.92 + (workerIndex % 4) * 0.05),
        [taskType, workerIndex]
    )
    const currentPathRef = useRef(activePath)
    const positionRef = useRef(activePath[0]?.clone() ?? new THREE.Vector3())
    const waypointIndex = useRef(activePath.length > 1 ? 1 : 0)
    const pauseUntil = useRef(phaseOffset * 0.18)
    const isPaused = useRef(activePath.length <= 1)
    const motionState = useRef(activePath.length > 1 ? 'walking' : 'working')

    useEffect(() => {
        const targetPath = panicActive ? panicPath : normalPath
        const currentPosition = positionRef.current.clone()
        const rebasedPath = sanitizePoints([currentPosition, ...targetPath.filter((point) => !almostSamePoint(point, currentPosition))])

        if (rebasedPath.length) {
            currentPathRef.current = rebasedPath
            positionRef.current = rebasedPath[0].clone()
            waypointIndex.current = rebasedPath.length > 1 ? 1 : 0
            isPaused.current = rebasedPath.length <= 1
            motionState.current = panicActive ? 'panic' : rebasedPath.length > 1 ? 'walking' : 'working'
        }
    }, [normalPath, panicActive, panicPath])

    useFrame(({ clock }, delta) => {
        const t = clock.getElapsedTime() * speed + phaseOffset
        const position = positionRef.current
        const path = currentPathRef.current
        const target = path[waypointIndex.current]
        const moveSpeedMultiplier = panicActive ? 1.85 : 1

        if (group.current) {
            group.current.position.copy(position)
        }

        if (path.length > 1) {
            if (isPaused.current) {
                if (t >= pauseUntil.current) {
                    isPaused.current = false
                    motionState.current = taskType === 'carry' ? 'carrying' : 'walking'
                    waypointIndex.current = (waypointIndex.current + 1) % path.length
                }
            } else if (target) {
                const direction = target.clone().sub(position)
                const distance = direction.length()

                if (distance < 0.14) {
                    isPaused.current = true
                    pauseUntil.current = t + (panicActive ? 0.08 : TASK_PAUSES[taskType])
                    motionState.current = panicActive ? 'panic' : 'working'
                } else {
                    direction.normalize()
                    const step = Math.min(distance, baseMoveSpeed * moveSpeedMultiplier * speed * delta)
                    const nextPosition = position.clone().addScaledVector(direction, step)

                    if (pathSegmentBlocked(position, nextPosition, obstacles)) {
                        waypointIndex.current = waypointIndex.current > 1 ? waypointIndex.current - 1 : (waypointIndex.current + 1) % path.length
                        isPaused.current = true
                        pauseUntil.current = t + 0.12
                        motionState.current = panicActive ? 'panic' : 'walking'
                    } else {
                        position.copy(nextPosition)
                    }

                    if (group.current) {
                        group.current.rotation.y = Math.atan2(direction.x, direction.z)
                    }

                    motionState.current = panicActive ? 'panic' : taskType === 'carry' ? 'carrying' : 'walking'
                }
            }
        }

        if (bodyBob.current) {
            bodyBob.current.position.y = 0
            bodyBob.current.rotation.z = 0
            bodyBob.current.rotation.x = 0
        }

        if (leftArm.current) leftArm.current.rotation.x = 0
        if (rightArm.current) rightArm.current.rotation.x = 0
        if (leftLeg.current) leftLeg.current.rotation.x = 0
        if (rightLeg.current) rightLeg.current.rotation.x = 0

        if (motionState.current === 'walking' || motionState.current === 'carrying' || motionState.current === 'panic') {
            const swing = Math.sin(t * (motionState.current === 'panic' ? 8 : 5)) * (motionState.current === 'carrying' ? 0.25 : motionState.current === 'panic' ? 0.9 : 0.6)
            if (leftArm.current) leftArm.current.rotation.x = swing
            if (rightArm.current) rightArm.current.rotation.x = -swing
            if (leftLeg.current) leftLeg.current.rotation.x = -swing * (motionState.current === 'panic' ? 1.05 : 0.8)
            if (rightLeg.current) rightLeg.current.rotation.x = swing * (motionState.current === 'panic' ? 1.05 : 0.8)
            if (bodyBob.current) bodyBob.current.position.y = Math.abs(Math.sin(t * (motionState.current === 'panic' ? 8 : 5))) * (motionState.current === 'panic' ? 0.08 : 0.05)
        } else if (taskType === 'lift') {
            const heave = Math.sin(t * 3.4) * 0.45
            if (leftArm.current) leftArm.current.rotation.x = -1.1 + heave * 0.4
            if (rightArm.current) rightArm.current.rotation.x = -1.1 + heave * 0.4
            if (leftLeg.current) leftLeg.current.rotation.x = 0.18
            if (rightLeg.current) rightLeg.current.rotation.x = 0.18
            if (bodyBob.current) {
                bodyBob.current.position.y = -0.04 + Math.abs(heave) * 0.08
                bodyBob.current.rotation.x = 0.1
            }
        } else if (taskType === 'sort') {
            if (rightArm.current) rightArm.current.rotation.x = -0.9 + Math.sin(t * 4.5) * 0.45
            if (leftArm.current) leftArm.current.rotation.x = -0.25 + Math.sin(t * 3.2) * 0.25
            if (bodyBob.current) bodyBob.current.rotation.z = Math.sin(t * 2.4) * 0.06
        } else if (taskType === 'inspect') {
            if (rightArm.current) rightArm.current.rotation.x = -0.45 + Math.sin(t * 2.5) * 0.12
            if (leftArm.current) leftArm.current.rotation.x = Math.sin(t * 1.8) * 0.08
            if (bodyBob.current) bodyBob.current.position.y = Math.sin(t * 1.6) * 0.02
        } else {
            const sway = Math.sin(t * 1.4) * 0.1
            if (leftArm.current) leftArm.current.rotation.x = sway
            if (rightArm.current) rightArm.current.rotation.x = -sway * 0.5
            if (bodyBob.current) bodyBob.current.position.y = Math.sin(t * 1.5) * 0.02
        }

        if (carriedLoad.current) {
            carriedLoad.current.visible = !panicActive && (taskType === 'carry' || taskType === 'lift')
            carriedLoad.current.position.y = taskType === 'lift' && motionState.current === 'working' ? 0.94 : 1.02
            carriedLoad.current.rotation.z = taskType === 'carry' ? Math.sin(t * 5) * 0.03 : 0
        }
    })

    const pantsColor = '#203a5e'
    const shirtColor = '#4b5563'
    const bootColor = '#252525'
    const sleeveColor = '#5b6472'
    const vestTrimColor = '#1f2937'
    const reflectiveColor = '#d9dde3'

    return (
        <group ref={group} position={activePath[0] ?? route[0]} scale={[0.98, 0.98, 0.98]}>
            <group ref={bodyBob}>
                {/* Legs */}
                <group ref={leftLeg} position={[-0.11, 0.92, 0]}>
                    <mesh position={[0, -0.24, 0]} castShadow>
                        <boxGeometry args={[0.14, 0.48, 0.16]} />
                        <meshStandardMaterial color={pantsColor} />
                    </mesh>
                    <mesh position={[0, -0.69, 0.02]} castShadow>
                        <boxGeometry args={[0.12, 0.42, 0.12]} />
                        <meshStandardMaterial color="#2f4a72" />
                    </mesh>
                    <mesh position={[0, -0.93, 0.07]} castShadow>
                        <boxGeometry args={[0.15, 0.08, 0.28]} />
                        <meshStandardMaterial color={bootColor} />
                    </mesh>
                </group>
                <group ref={rightLeg} position={[0.11, 0.92, 0]}>
                    <mesh position={[0, -0.24, 0]} castShadow>
                        <boxGeometry args={[0.14, 0.48, 0.16]} />
                        <meshStandardMaterial color={pantsColor} />
                    </mesh>
                    <mesh position={[0, -0.69, 0.02]} castShadow>
                        <boxGeometry args={[0.12, 0.42, 0.12]} />
                        <meshStandardMaterial color="#2f4a72" />
                    </mesh>
                    <mesh position={[0, -0.93, 0.07]} castShadow>
                        <boxGeometry args={[0.15, 0.08, 0.28]} />
                        <meshStandardMaterial color={bootColor} />
                    </mesh>
                </group>

                {/* Torso */}
                <mesh position={[0, 1.03, 0]} castShadow>
                    <boxGeometry args={[0.3, 0.24, 0.2]} />
                    <meshStandardMaterial color="#44505f" />
                </mesh>
                <mesh position={[0, 1.29, 0]} castShadow>
                    <boxGeometry args={[0.38, 0.52, 0.22]} />
                    <meshStandardMaterial color={shirtColor} />
                </mesh>
                <mesh position={[0, 1.53, 0]} castShadow>
                    <boxGeometry args={[0.1, 0.12, 0.1]} />
                    <meshStandardMaterial color={skinTone} />
                </mesh>
                <mesh position={[0, 1.56, 0]} castShadow>
                    <boxGeometry args={[0.43, 0.08, 0.2]} />
                    <meshStandardMaterial color={shirtColor} />
                </mesh>
                <mesh ref={carriedLoad} position={[0, 1.06, 0.26]} castShadow>
                    <boxGeometry args={[0.25, 0.19, 0.19]} />
                    <meshStandardMaterial color="#9a5b17" roughness={0.78} />
                </mesh>

                {/* Safety Vest */}
                {ppeConfig.vest && (
                    <>
                        <mesh position={[0, 1.29, 0.035]} castShadow>
                            <boxGeometry args={[0.42, 0.54, 0.12]} />
                            <meshStandardMaterial color={vestColor} emissive={vestColor} emissiveIntensity={0.22} />
                        </mesh>
                        <mesh position={[0, 1.29, -0.035]} castShadow>
                            <boxGeometry args={[0.42, 0.54, 0.12]} />
                            <meshStandardMaterial color={vestColor} emissive={vestColor} emissiveIntensity={0.16} />
                        </mesh>
                        <mesh position={[0, 1.53, 0.02]} castShadow rotation={[0.62, 0, 0]}>
                            <boxGeometry args={[0.1, 0.22, 0.02]} />
                            <meshStandardMaterial color={vestColor} emissive={vestColor} emissiveIntensity={0.2} />
                        </mesh>
                        <mesh position={[0, 1.53, -0.02]} castShadow rotation={[-0.62, 0, 0]}>
                            <boxGeometry args={[0.1, 0.22, 0.02]} />
                            <meshStandardMaterial color={vestColor} emissive={vestColor} emissiveIntensity={0.15} />
                        </mesh>
                        <mesh position={[0, 1.39, 0.1]}>
                            <boxGeometry args={[0.4, 0.045, 0.012]} />
                            <meshStandardMaterial color={reflectiveColor} metalness={0.78} roughness={0.28} />
                        </mesh>
                        <mesh position={[0, 1.18, 0.1]}>
                            <boxGeometry args={[0.4, 0.045, 0.012]} />
                            <meshStandardMaterial color={reflectiveColor} metalness={0.78} roughness={0.28} />
                        </mesh>
                        <mesh position={[0, 1.39, -0.1]}>
                            <boxGeometry args={[0.4, 0.045, 0.012]} />
                            <meshStandardMaterial color={reflectiveColor} metalness={0.72} roughness={0.28} />
                        </mesh>
                        <mesh position={[0, 1.18, -0.1]}>
                            <boxGeometry args={[0.4, 0.045, 0.012]} />
                            <meshStandardMaterial color={reflectiveColor} metalness={0.72} roughness={0.28} />
                        </mesh>
                        <mesh position={[0.205, 1.29, 0]} castShadow>
                            <boxGeometry args={[0.03, 0.54, 0.18]} />
                            <meshStandardMaterial color={vestTrimColor} />
                        </mesh>
                        <mesh position={[-0.205, 1.29, 0]} castShadow>
                            <boxGeometry args={[0.03, 0.54, 0.18]} />
                            <meshStandardMaterial color={vestTrimColor} />
                        </mesh>
                    </>
                )}

                {/* Arms */}
                <group ref={leftArm} position={[-0.25, 1.4, 0]}>
                    <mesh position={[0, -0.19, 0]} castShadow>
                        <boxGeometry args={[0.1, 0.36, 0.1]} />
                        <meshStandardMaterial color={sleeveColor} />
                    </mesh>
                    <mesh position={[0, -0.52, 0]} castShadow>
                        <boxGeometry args={[0.09, 0.34, 0.09]} />
                        <meshStandardMaterial color="#4b5563" />
                    </mesh>
                    <mesh position={[-0.056, -0.15, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
                        <planeGeometry args={[0.16, 0.16]} />
                        <meshBasicMaterial map={qrBadgeTexture} toneMapped={false} />
                    </mesh>
                    {ppeConfig.gloves ? (
                        <group position={[0, -0.77, 0.02]}>
                            <mesh castShadow>
                                <boxGeometry args={[0.075, 0.085, 0.08]} />
                                <meshStandardMaterial color={gloveColor} roughness={0.72} />
                            </mesh>
                            <mesh position={[0, -0.02, 0.045]} castShadow>
                                <sphereGeometry args={[0.038, 8, 8]} />
                                <meshStandardMaterial color={gloveColor} roughness={0.7} />
                            </mesh>
                            <mesh position={[0, 0.055, 0]} castShadow>
                                <boxGeometry args={[0.068, 0.028, 0.07]} />
                                <meshStandardMaterial color="#cbd5e1" roughness={0.45} metalness={0.1} />
                            </mesh>
                        </group>
                    ) : (
                        <mesh position={[0, -0.77, 0.02]} castShadow>
                            <sphereGeometry args={[0.05, 8, 8]} />
                            <meshStandardMaterial color={skinTone} />
                        </mesh>
                    )}
                </group>
                <group ref={rightArm} position={[0.25, 1.4, 0]}>
                    <mesh position={[0, -0.19, 0]} castShadow>
                        <boxGeometry args={[0.1, 0.36, 0.1]} />
                        <meshStandardMaterial color={sleeveColor} />
                    </mesh>
                    <mesh position={[0, -0.52, 0]} castShadow>
                        <boxGeometry args={[0.09, 0.34, 0.09]} />
                        <meshStandardMaterial color="#4b5563" />
                    </mesh>
                    <mesh position={[0.056, -0.15, 0]} rotation={[0, -Math.PI / 2, 0]} castShadow>
                        <planeGeometry args={[0.16, 0.16]} />
                        <meshBasicMaterial map={qrBadgeTexture} toneMapped={false} />
                    </mesh>
                    {ppeConfig.gloves ? (
                        <group position={[0, -0.77, 0.02]}>
                            <mesh castShadow>
                                <boxGeometry args={[0.075, 0.085, 0.08]} />
                                <meshStandardMaterial color={gloveColor} roughness={0.72} />
                            </mesh>
                            <mesh position={[0, -0.02, 0.045]} castShadow>
                                <sphereGeometry args={[0.038, 8, 8]} />
                                <meshStandardMaterial color={gloveColor} roughness={0.7} />
                            </mesh>
                            <mesh position={[0, 0.055, 0]} castShadow>
                                <boxGeometry args={[0.068, 0.028, 0.07]} />
                                <meshStandardMaterial color="#cbd5e1" roughness={0.45} metalness={0.1} />
                            </mesh>
                        </group>
                    ) : (
                        <mesh position={[0, -0.77, 0.02]} castShadow>
                            <sphereGeometry args={[0.05, 8, 8]} />
                            <meshStandardMaterial color={skinTone} />
                        </mesh>
                    )}
                </group>

                {/* Head */}
                <mesh position={[0, 1.78, 0]} castShadow>
                    <sphereGeometry args={[0.145, 14, 12]} />
                    <meshStandardMaterial color={skinTone} />
                </mesh>
                <mesh position={[-0.047, 1.79, 0.125]}>
                    <sphereGeometry args={[0.016, 6, 6]} />
                    <meshStandardMaterial color="#1a1a1a" />
                </mesh>
                <mesh position={[0.047, 1.79, 0.125]}>
                    <sphereGeometry args={[0.016, 6, 6]} />
                    <meshStandardMaterial color="#1a1a1a" />
                </mesh>
                <mesh position={[0, 1.69, 0.142]}>
                    <boxGeometry args={[0.05, 0.018, 0.02]} />
                    <meshStandardMaterial color="#9a3412" />
                </mesh>
                <mesh position={[0, 1.75, 0.15]} castShadow>
                    <boxGeometry args={[0.028, 0.05, 0.02]} />
                    <meshStandardMaterial color={skinTone} />
                </mesh>

                {/* Helmet */}
                {ppeConfig.helmet && (
                    <group position={[0, 1.94, 0]}>
                        <mesh castShadow>
                            <sphereGeometry args={[0.18, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
                            <meshStandardMaterial color={helmetColor} roughness={0.34} metalness={0.08} />
                        </mesh>
                        <mesh position={[0, -0.02, 0]} castShadow>
                            <cylinderGeometry args={[0.19, 0.21, 0.04, 14]} />
                            <meshStandardMaterial color={helmetColor} roughness={0.34} metalness={0.08} />
                        </mesh>
                        <mesh position={[0, -0.04, 0.12]} castShadow>
                            <boxGeometry args={[0.18, 0.02, 0.08]} />
                            <meshStandardMaterial color={helmetColor} roughness={0.34} metalness={0.08} />
                        </mesh>
                    </group>
                )}

                {/* Floating label */}
                {showLabel ? (
                    <Html position={[0, 2.42, 0]} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
                        <div
                            style={{
                                background: 'rgba(30,41,59,0.85)',
                                color: '#fff',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 700,
                                fontFamily: "'Inter', sans-serif",
                                whiteSpace: 'nowrap',
                                border: '1px solid rgba(255,255,255,0.1)',
                                userSelect: 'none',
                            }}
                        >
                            {id}
                        </div>
                    </Html>
                ) : null}
            </group>
        </group>
    )
}

import { Html } from '@react-three/drei'
import useCameraControls from '../hooks/useCameraControls'

const HUB_SIZE = { width: 40, depth: 30, wallHeight: 9 }
const ROOM_SIZE = { width: 34, depth: 24, wallHeight: 9 }

function Floor({ width, depth, color = '#52525b' }) {
    return (
        <group>
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
                <planeGeometry args={[width, depth]} />
                <meshStandardMaterial color={color} roughness={0.82} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0.01, 0]}>
                <planeGeometry args={[width * 0.96, depth * 0.88]} />
                <meshStandardMaterial color="#6b7280" roughness={0.92} transparent opacity={0.16} />
            </mesh>
            {[-depth / 4, 0, depth / 4].map((z) => (
                <mesh key={z} position={[0, 0.02, z]} receiveShadow>
                    <boxGeometry args={[width * 0.72, 0.03, 0.14]} />
                    <meshStandardMaterial color="#f8fafc" emissive="#f8fafc" emissiveIntensity={0.08} />
                </mesh>
            ))}
            {[-width / 3, width / 3].map((x) => (
                <mesh key={x} position={[x, 0.02, 0]} receiveShadow>
                    <boxGeometry args={[0.16, 0.03, depth * 0.72]} />
                    <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.12} />
                </mesh>
            ))}
        </group>
    )
}

function CeilingBeamRow({ width, depth, height }) {
    return (
        <>
            {[-width / 3, 0, width / 3].map((x) => (
                <mesh key={x} position={[x, height - 0.6, 0]} castShadow>
                    <boxGeometry args={[0.55, 0.42, depth - 1]} />
                    <meshStandardMaterial color="#6b7280" metalness={0.35} roughness={0.5} />
                </mesh>
            ))}
        </>
    )
}

function CeilingPanels({ width, depth, height }) {
    return (
        <group>
            <mesh position={[0, height, 0]} receiveShadow>
                <boxGeometry args={[width, 0.18, depth]} />
                <meshStandardMaterial color="#d9dee5" roughness={0.92} metalness={0.04} />
            </mesh>
            {[-width / 3, 0, width / 3].map((x) => (
                <mesh key={x} position={[x, height - 0.18, 0]} receiveShadow>
                    <boxGeometry args={[0.36, 0.16, depth - 1.4]} />
                    <meshStandardMaterial color="#7c8796" roughness={0.55} metalness={0.42} />
                </mesh>
            ))}
        </group>
    )
}

function BayLights({ width, depth, height, tint = '#fff7ed' }) {
    return (
        <>
            {[-width / 4, 0, width / 4].map((x) => (
                <group key={x} position={[x, height - 0.45, 0]}>
                    <mesh castShadow receiveShadow>
                        <boxGeometry args={[1.8, 0.14, depth * 0.58]} />
                        <meshStandardMaterial color="#dbe4ee" emissive={tint} emissiveIntensity={0.55} />
                    </mesh>
                    <mesh position={[0, -0.18, 0]} castShadow>
                        <boxGeometry args={[1.35, 0.05, depth * 0.54]} />
                        <meshStandardMaterial color="#fef3c7" emissive={tint} emissiveIntensity={1.2} />
                    </mesh>
                </group>
            ))}
        </>
    )
}

function WallPanels({ width, height, depth, accent = '#64748b' }) {
    return (
        <>
            <mesh position={[0, height * 0.68, -depth / 2 + 0.18]} receiveShadow>
                <boxGeometry args={[width * 0.82, 0.22, 0.12]} />
                <meshStandardMaterial color={accent} roughness={0.58} metalness={0.22} />
            </mesh>
            <mesh position={[-width / 2 + 0.18, height * 0.55, 0]} receiveShadow>
                <boxGeometry args={[0.12, 0.22, depth * 0.58]} />
                <meshStandardMaterial color="#94a3b8" roughness={0.5} metalness={0.18} />
            </mesh>
            <mesh position={[width / 2 - 0.18, height * 0.55, 0]} receiveShadow>
                <boxGeometry args={[0.12, 0.22, depth * 0.58]} />
                <meshStandardMaterial color="#94a3b8" roughness={0.5} metalness={0.18} />
            </mesh>
        </>
    )
}

function DoorTrigger({ position, rotation = [0, 0, 0], label, accent = '#22d3ee', onClick }) {
    return (
        <group position={position} rotation={rotation}>
            <mesh
                position={[0, 2, 0]}
                onClick={onClick}
                onPointerOver={() => { document.body.style.cursor = 'pointer' }}
                onPointerOut={() => { document.body.style.cursor = 'default' }}
            >
                <boxGeometry args={[3.8, 4.4, 0.28]} />
                <meshStandardMaterial color="#0f172a" />
            </mesh>
            <mesh position={[0, 2, 0.12]} castShadow receiveShadow>
                <boxGeometry args={[3.2, 3.8, 0.12]} />
                <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.2} />
            </mesh>
            <Html position={[0, 4.65, 0]} center distanceFactor={14} style={{ pointerEvents: 'auto' }}>
                <div
                    onClick={onClick}
                    style={{
                        background: 'rgba(15, 23, 42, 0.92)',
                        color: '#f8fafc',
                        border: `1px solid ${accent}`,
                        borderRadius: '999px',
                        padding: '5px 10px',
                        fontSize: '11px',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                        userSelect: 'none',
                    }}
                >
                    {label}
                </div>
            </Html>
        </group>
    )
}

function PalletStack({ position, levels = 3, color = '#8b7355' }) {
    return (
        <group position={position}>
            {Array.from({ length: levels }, (_, index) => (
                <group key={index} position={[0, index * 0.16, 0]}>
                    {[-0.46, 0, 0.46].map((z) => (
                        <mesh key={z} position={[0, 0.07, z]} castShadow receiveShadow>
                            <boxGeometry args={[1.5, 0.035, 0.24]} />
                            <meshStandardMaterial color={color} roughness={0.88} />
                        </mesh>
                    ))}
                    {[-0.48, 0.48].map((x) => (
                        <mesh key={x} position={[x, 0.02, 0]} castShadow receiveShadow>
                            <boxGeometry args={[0.09, 0.08, 1.2]} />
                            <meshStandardMaterial color="#6f5434" roughness={0.9} />
                        </mesh>
                    ))}
                </group>
            ))}
        </group>
    )
}

function Crate({ position, size = 1, color = '#b7791f' }) {
    return (
        <group position={[position[0], size / 2, position[2]]}>
            <mesh castShadow receiveShadow>
                <boxGeometry args={[size, size, size]} />
                <meshStandardMaterial color={color} roughness={0.85} />
            </mesh>
            <mesh position={[0, 0, size / 2 + 0.001]}>
                <boxGeometry args={[size * 0.9, size * 0.9, 0.01]} />
                <meshStandardMaterial color="#9a5b17" roughness={0.92} />
            </mesh>
        </group>
    )
}

function Barrel({ position, color = '#4a5568' }) {
    return (
        <mesh position={[position[0], 0.7, position[2]]} castShadow>
            <cylinderGeometry args={[0.45, 0.5, 1.4, 12]} />
            <meshStandardMaterial color={color} metalness={0.35} roughness={0.55} />
        </mesh>
    )
}

function Forklift({ position, color = '#d69e2e' }) {
    return (
        <group position={position}>
            {[
                [-0.72, 0.26, -1.08],
                [0.72, 0.26, -1.08],
                [-0.72, 0.26, 1.08],
                [0.72, 0.26, 1.08],
            ].map(([x, y, z]) => (
                <mesh key={`${x}-${z}`} position={[x, y, z]} castShadow>
                    <cylinderGeometry args={[0.28, 0.28, 0.18, 18]} rotation={[Math.PI / 2, 0, 0]} />
                    <meshStandardMaterial color="#111827" roughness={0.65} />
                </mesh>
            ))}
            <mesh position={[0, 0.8, 0]} castShadow>
                <boxGeometry args={[1.8, 1.2, 3]} />
                <meshStandardMaterial color={color} roughness={0.58} />
            </mesh>
            <mesh position={[0, 1.8, -0.3]} castShadow>
                <boxGeometry args={[1.6, 1.2, 1.5]} />
                <meshStandardMaterial color="#1f2937" />
            </mesh>
            {[-0.5, 0.5].map((x) => (
                <mesh key={x} position={[x, 0.15, 1.8]} castShadow>
                    <boxGeometry args={[0.15, 0.1, 1.5]} />
                    <meshStandardMaterial color="#cbd5e1" metalness={0.7} />
                </mesh>
            ))}
            <mesh position={[0, 1.2, 1.3]} castShadow>
                <boxGeometry args={[1.4, 2.4, 0.15]} />
                <meshStandardMaterial color="#64748b" metalness={0.55} />
            </mesh>
            <mesh position={[0, 1.95, -0.85]} castShadow>
                <boxGeometry args={[1.35, 0.08, 0.08]} />
                <meshStandardMaterial color="#475569" metalness={0.48} />
            </mesh>
        </group>
    )
}

function ConveyorBelt({ position, length = 10 }) {
    return (
        <group position={position}>
            <mesh position={[0, 1.2, 0]} castShadow>
                <boxGeometry args={[length, 0.15, 1.4]} />
                <meshStandardMaterial color="#1f2937" roughness={0.4} metalness={0.6} />
            </mesh>
            {Array.from({ length: Math.max(6, Math.floor(length * 1.2)) }, (_, index) => {
                const x = -length / 2 + 0.5 + index * (length / Math.max(6, Math.floor(length * 1.2)))
                return (
                    <mesh key={index} position={[x, 1.29, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
                        <cylinderGeometry args={[0.03, 0.03, 1.16, 10]} />
                        <meshStandardMaterial color="#0f172a" metalness={0.82} roughness={0.26} />
                    </mesh>
                )
            })}
            {[-(length / 2 - 0.5), 0, length / 2 - 0.5].map((x) => (
                <mesh key={x} position={[x, 0.6, 0]} castShadow>
                    <boxGeometry args={[0.3, 1.2, 1.6]} />
                    <meshStandardMaterial color="#64748b" metalness={0.45} roughness={0.45} />
                </mesh>
            ))}
            {[-0.75, 0.75].map((z) => (
                <mesh key={z} position={[0, 1.4, z]} castShadow>
                    <boxGeometry args={[length, 0.2, 0.08]} />
                    <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.3} />
                </mesh>
            ))}
            <mesh position={[length / 2 - 0.6, 1.48, 0.88]} castShadow>
                <boxGeometry args={[0.18, 0.1, 0.18]} />
                <meshStandardMaterial color="#ef4444" roughness={0.66} />
            </mesh>
        </group>
    )
}

function Workbench({ position }) {
    return (
        <group position={position}>
            <mesh position={[0, 1.05, 0]} castShadow receiveShadow>
                <boxGeometry args={[3.6, 0.18, 1.4]} />
                <meshStandardMaterial color="#8b5a2b" roughness={0.85} />
            </mesh>
            {[-1.5, 1.5].flatMap((x) => [-0.5, 0.5].map((z) => [x, z])).map(([x, z]) => (
                <mesh key={`${x}-${z}`} position={[x, 0.5, z]} castShadow>
                    <boxGeometry args={[0.12, 1, 0.12]} />
                    <meshStandardMaterial color="#4b5563" metalness={0.4} />
                </mesh>
            ))}
            <mesh position={[-0.9, 1.35, 0.15]} castShadow>
                <boxGeometry args={[0.6, 0.16, 0.35]} />
                <meshStandardMaterial color="#ef4444" roughness={0.7} />
            </mesh>
            <mesh position={[0.5, 1.35, -0.1]} castShadow>
                <cylinderGeometry args={[0.16, 0.16, 0.32, 12]} />
                <meshStandardMaterial color="#0f172a" />
            </mesh>
        </group>
    )
}

function ShelvingRack({ position, width = 7, levels = 3, color = '#64748b' }) {
    const uprightXs = [-width / 2, -width / 6, width / 6, width / 2]

    return (
        <group position={position}>
            {uprightXs.map((x) => (
                <mesh key={x} position={[x, 2.1, 0]} castShadow>
                    <boxGeometry args={[0.14, 4.2, 1.5]} />
                    <meshStandardMaterial color={color} metalness={0.45} roughness={0.4} />
                </mesh>
            ))}
            {Array.from({ length: levels }, (_, index) => (
                <mesh key={index} position={[0, 0.7 + index * 1.3, 0]} castShadow receiveShadow>
                    <boxGeometry args={[width, 0.12, 1.6]} />
                    <meshStandardMaterial color="#94a3b8" metalness={0.3} roughness={0.55} />
                </mesh>
            ))}
        </group>
    )
}

function ColdRack({ position }) {
    return (
        <group position={position}>
            <mesh position={[0, 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[4.4, 4.2, 2.2]} />
                <meshStandardMaterial color="#dbeafe" roughness={0.6} metalness={0.15} />
            </mesh>
            <mesh position={[0, 2, 1.12]} castShadow receiveShadow>
                <boxGeometry args={[3.8, 3.8, 0.08]} />
                <meshStandardMaterial color="#93c5fd" opacity={0.45} transparent />
            </mesh>
        </group>
    )
}

function InspectionPod({ position }) {
    return (
        <group position={position}>
            <mesh position={[0, 1.15, 0]} castShadow receiveShadow>
                <boxGeometry args={[5.6, 0.16, 1.8]} />
                <meshStandardMaterial color="#475569" roughness={0.72} />
            </mesh>
            {[-2.4, -0.8, 0.8, 2.4].map((x) => (
                <mesh key={x} position={[x, 1.5, 0]} castShadow>
                    <boxGeometry args={[0.9, 0.5, 0.9]} />
                    <meshStandardMaterial color="#e5e7eb" roughness={0.6} />
                </mesh>
            ))}
        </group>
    )
}

function HubScene({ roomOptions, onEnterRoom }) {
    const doorSpacing = roomOptions.length > 1 ? 24 / (roomOptions.length - 1) : 0
    const startX = -12

    return (
        <>
            <Floor width={HUB_SIZE.width} depth={HUB_SIZE.depth} color="#737f8c" />
            <mesh position={[0, HUB_SIZE.wallHeight / 2, -HUB_SIZE.depth / 2]} castShadow receiveShadow>
                <boxGeometry args={[HUB_SIZE.width, HUB_SIZE.wallHeight, 0.3]} />
                <meshStandardMaterial color="#7b8794" roughness={0.86} />
            </mesh>
            {[-HUB_SIZE.width / 2, HUB_SIZE.width / 2].map((x) => (
                <mesh key={x} position={[x, HUB_SIZE.wallHeight / 2, 0]} castShadow receiveShadow>
                    <boxGeometry args={[0.35, HUB_SIZE.wallHeight, HUB_SIZE.depth]} />
                    <meshStandardMaterial color="#7b8794" roughness={0.86} />
                </mesh>
            ))}
            <mesh position={[0, HUB_SIZE.wallHeight / 2, HUB_SIZE.depth / 2]} castShadow receiveShadow>
                <boxGeometry args={[HUB_SIZE.width, HUB_SIZE.wallHeight, 0.24]} />
                <meshStandardMaterial color="#6b7785" roughness={0.9} transparent opacity={0.3} />
            </mesh>
            <CeilingPanels width={HUB_SIZE.width} depth={HUB_SIZE.depth} height={HUB_SIZE.wallHeight} />
            <CeilingBeamRow width={HUB_SIZE.width} depth={HUB_SIZE.depth} height={HUB_SIZE.wallHeight} />
            <BayLights width={HUB_SIZE.width} depth={HUB_SIZE.depth} height={HUB_SIZE.wallHeight} tint="#fff1bf" />
            <WallPanels width={HUB_SIZE.width} depth={HUB_SIZE.depth} height={HUB_SIZE.wallHeight} accent="#38bdf8" />

            {roomOptions.map((room, index) => (
                <DoorTrigger
                    key={room.id}
                    position={[startX + index * doorSpacing, 0, -HUB_SIZE.depth / 2 + 0.22]}
                    label={room.name}
                    accent={room.accent}
                    onClick={() => onEnterRoom(index)}
                />
            ))}

            <Html position={[0, 7.1, -HUB_SIZE.depth / 2 + 0.3]} center distanceFactor={18} style={{ pointerEvents: 'none' }}>
                <div
                    style={{
                        background: 'rgba(15, 23, 42, 0.92)',
                        color: '#67e8f9',
                        border: '1px solid rgba(103, 232, 249, 0.7)',
                        borderRadius: '999px',
                        padding: '7px 14px',
                        fontSize: '12px',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                    }}
                >
                    Open Bay: choose a door to enter a room
                </div>
            </Html>

            <ConveyorBelt position={[-8, 0, 2]} length={11} />
            <PalletStack position={[10, 0, 6]} levels={4} />
            <PalletStack position={[13, 0, 6]} levels={3} />
            <Forklift position={[9, 0, -2]} color="#0891b2" />
            <ShelvingRack position={[-12, 0, 9]} width={7} />
            <Crate position={[2, 0, 5]} size={0.9} />
            <Crate position={[4, 0, 4.5]} size={0.8} color="#975a16" />
        </>
    )
}

function RoomScene({ room, onReturnToHub }) {
    const halfWidth = ROOM_SIZE.width / 2
    const halfDepth = ROOM_SIZE.depth / 2
    const wallThickness = 0.24
    const doorwayWidth = 4.4
    const sideSegmentWidth = (ROOM_SIZE.width - doorwayWidth) / 2

    return (
        <>
            <Floor width={ROOM_SIZE.width} depth={ROOM_SIZE.depth} color={room.id === 'cold' ? '#d8e6f7' : '#737f8c'} />
            <mesh position={[0, ROOM_SIZE.wallHeight / 2, -halfDepth]} castShadow receiveShadow>
                <boxGeometry args={[ROOM_SIZE.width, ROOM_SIZE.wallHeight, wallThickness]} />
                <meshStandardMaterial color={room.id === 'cold' ? '#dce8f8' : '#7c8796'} roughness={0.88} />
            </mesh>
            <mesh position={[-halfWidth, ROOM_SIZE.wallHeight / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[wallThickness, ROOM_SIZE.wallHeight, ROOM_SIZE.depth]} />
                <meshStandardMaterial color={room.id === 'cold' ? '#dce8f8' : '#7c8796'} roughness={0.88} />
            </mesh>
            <mesh position={[halfWidth, ROOM_SIZE.wallHeight / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[wallThickness, ROOM_SIZE.wallHeight, ROOM_SIZE.depth]} />
                <meshStandardMaterial color={room.id === 'cold' ? '#dce8f8' : '#7c8796'} roughness={0.88} />
            </mesh>
            <mesh position={[-(doorwayWidth / 2 + sideSegmentWidth / 2), ROOM_SIZE.wallHeight / 2, halfDepth]} castShadow receiveShadow>
                <boxGeometry args={[sideSegmentWidth, ROOM_SIZE.wallHeight, wallThickness]} />
                <meshStandardMaterial color={room.id === 'cold' ? '#dce8f8' : '#7c8796'} roughness={0.88} />
            </mesh>
            <mesh position={[doorwayWidth / 2 + sideSegmentWidth / 2, ROOM_SIZE.wallHeight / 2, halfDepth]} castShadow receiveShadow>
                <boxGeometry args={[sideSegmentWidth, ROOM_SIZE.wallHeight, wallThickness]} />
                <meshStandardMaterial color={room.id === 'cold' ? '#dce8f8' : '#7c8796'} roughness={0.88} />
            </mesh>
            <mesh position={[0, ROOM_SIZE.wallHeight - 0.65, halfDepth]} castShadow receiveShadow>
                <boxGeometry args={[doorwayWidth, 1.3, wallThickness]} />
                <meshStandardMaterial color="#687585" roughness={0.82} />
            </mesh>
            <mesh position={[0, 0.03, 0]}>
                <boxGeometry args={[ROOM_SIZE.width + 0.35, 0.06, ROOM_SIZE.depth + 0.35]} />
                <meshStandardMaterial color={room.accent} emissive={room.accent} emissiveIntensity={0.16} transparent opacity={0.14} />
            </mesh>
            <CeilingPanels width={ROOM_SIZE.width} depth={ROOM_SIZE.depth} height={ROOM_SIZE.wallHeight} />
            <BayLights width={ROOM_SIZE.width} depth={ROOM_SIZE.depth} height={ROOM_SIZE.wallHeight} tint={room.id === 'cold' ? '#dbeafe' : '#fff3bf'} />
            <WallPanels width={ROOM_SIZE.width} depth={ROOM_SIZE.depth} height={ROOM_SIZE.wallHeight} accent={room.accent} />

            <DoorTrigger
                position={[0, 0, halfDepth - 0.18]}
                rotation={[0, Math.PI, 0]}
                label="Back To Open Bay"
                accent={room.accent}
                onClick={onReturnToHub}
            />

            <Html position={[0, 6.9, halfDepth - 0.18]} center distanceFactor={18} style={{ pointerEvents: 'none' }}>
                <div
                    style={{
                        background: 'rgba(15, 23, 42, 0.92)',
                        color: room.accent,
                        border: `1px solid ${room.accent}`,
                        borderRadius: '999px',
                        padding: '6px 12px',
                        fontSize: '12px',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                    }}
                >
                    {room.name}
                </div>
            </Html>

            <CeilingBeamRow width={ROOM_SIZE.width} depth={ROOM_SIZE.depth} height={ROOM_SIZE.wallHeight} />
            <RoomEnvironment roomId={room.id} />
        </>
    )
}

function RoomEnvironment({ roomId }) {
    switch (roomId) {
        case 'receiving':
            return (
                <>
                    <ConveyorBelt position={[-2, 0, -4]} length={13} />
                    <PalletStack position={[-10, 0, 6]} levels={4} />
                    <PalletStack position={[-6, 0, 6]} levels={3} />
                    <Forklift position={[9, 0, 5]} />
                    <Crate position={[5, 0, 2]} size={1} />
                    <Crate position={[7, 0, 1]} size={0.8} color="#975a16" />
                    <ShelvingRack position={[10, 0, -7]} width={6} />
                </>
            )
        case 'packing':
            return (
                <>
                    <ConveyorBelt position={[-5, 0, -3]} length={10} />
                    <ConveyorBelt position={[7, 0, 3]} length={8} />
                    <Workbench position={[8, 0, -6]} />
                    <ShelvingRack position={[-10, 0, 6]} width={7} />
                    <Crate position={[1, 0, 6]} size={0.9} />
                    <Crate position={[3, 0, 6]} size={0.7} color="#975a16" />
                </>
            )
        case 'cold':
            return (
                <>
                    <ColdRack position={[-9, 0, -4]} />
                    <ColdRack position={[0, 0, -4]} />
                    <ColdRack position={[9, 0, -4]} />
                    <InspectionPod position={[6, 0, 5]} />
                    <Barrel position={[-8, 0, 7]} color="#60a5fa" />
                    <Barrel position={[-6.8, 0, 7]} color="#93c5fd" />
                </>
            )
        case 'maintenance':
            return (
                <>
                    <Workbench position={[-8, 0, -5]} />
                    <Workbench position={[5, 0, 4]} />
                    <Forklift position={[10, 0, -6]} color="#dc2626" />
                    <ShelvingRack position={[-9, 0, 7]} width={6} />
                    <Crate position={[1, 0, -2]} size={0.85} color="#92400e" />
                    <Barrel position={[3.5, 0, 7]} color="#475569" />
                </>
            )
        case 'quality':
            return (
                <>
                    <InspectionPod position={[-8, 0, -4]} />
                    <InspectionPod position={[5, 0, 2]} />
                    <ShelvingRack position={[10, 0, 7]} width={6} color="#7c3aed" />
                    <Crate position={[-2, 0, 7]} size={0.7} color="#a16207" />
                    <Crate position={[0, 0, 7]} size={0.7} color="#b45309" />
                </>
            )
        case 'dispatch':
            return (
                <>
                    <ConveyorBelt position={[-4, 0, -1]} length={12} />
                    <PalletStack position={[8, 0, 6]} levels={4} />
                    <PalletStack position={[12, 0, 6]} levels={3} />
                    <Forklift position={[10, 0, -7]} color="#16a34a" />
                    <ShelvingRack position={[-10, 0, 7]} width={7} />
                    <Crate position={[4, 0, 5]} size={0.95} />
                </>
            )
        default:
            return null
    }
}

function SceneLighting({ mode, areaId }) {
    if (mode === 'dark') {
        return (
            <>
                <ambientLight intensity={0.22} color={areaId === 'cold' ? '#dbeafe' : '#fff4d4'} />
                <spotLight position={[-9, 8.2, 5]} angle={0.7} penumbra={0.75} intensity={2} color="#fef3c7" castShadow />
                <spotLight position={[9, 8.2, -3]} angle={0.68} penumbra={0.72} intensity={1.9} color={areaId === 'cold' ? '#dbeafe' : '#fffbeb'} castShadow />
                <pointLight position={[0, 7.4, 0]} intensity={0.8} color={areaId === 'cold' ? '#bfdbfe' : '#fde68a'} distance={28} />
            </>
        )
    }

    if (mode === 'dim') {
        return (
            <>
                <ambientLight intensity={0.42} color={areaId === 'cold' ? '#dbeafe' : '#fff1cc'} />
                <pointLight position={[-9, 7.6, 5]} intensity={1.1} distance={28} color={areaId === 'maintenance' ? '#fecaca' : '#fde68a'} />
                <pointLight position={[8, 7.6, -3]} intensity={1} distance={26} color={areaId === 'quality' ? '#e9d5ff' : '#fed7aa'} />
                <directionalLight position={[8, 12, 6]} intensity={0.75} castShadow color="#fff7ed" />
            </>
        )
    }

    return (
        <>
            <ambientLight intensity={0.68} color={areaId === 'cold' ? '#eef7ff' : '#fff8ee'} />
            <directionalLight
                position={[14, 17, 10]}
                intensity={1.28}
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
                shadow-camera-far={42}
                shadow-camera-left={-24}
                shadow-camera-right={24}
                shadow-camera-top={20}
                shadow-camera-bottom={-20}
                color={areaId === 'cold' ? '#dbeafe' : '#fff7ed'}
            />
            <pointLight position={[-9, 7.6, 5]} intensity={0.9} distance={28} color={areaId === 'dispatch' ? '#bbf7d0' : '#fde68a'} />
            <pointLight position={[9, 7.6, -3]} intensity={0.82} distance={26} color={areaId === 'maintenance' ? '#fecaca' : '#d1fae5'} />
        </>
    )
}

function SceneFog({ mode, areaId }) {
    if (areaId === 'cold') {
        return <fog attach="fog" args={['#dbeafe', 22, 46]} />
    }

    if (mode === 'full') return <fog attach="fog" args={['#d7dee6', 34, 62]} />
    if (mode === 'dim') return <fog attach="fog" args={['#b2bcc8', 24, 48]} />
    return <fog attach="fog" args={['#7a8795', 18, 38]} />
}

function SceneBackground({ areaId, mode }) {
    if (areaId === 'cold') {
        return <color attach="background" args={['#dbeafe']} />
    }

    if (mode === 'dark') {
        return <color attach="background" args={['#7b8794']} />
    }

    if (mode === 'dim') {
        return <color attach="background" args={['#b9c4cf']} />
    }

    return <color attach="background" args={['#d9e0e7']} />
}

export default function Scene({
    lightingMode,
    selectedRoomIndex,
    currentArea,
    roomOptions,
    onEnterRoom,
    onReturnToHub,
}) {
    useCameraControls(selectedRoomIndex ?? 'hub', currentArea.id)

    return (
        <>
            <SceneBackground mode={lightingMode} areaId={currentArea.id} />
            <SceneFog mode={lightingMode} areaId={currentArea.id} />
            <SceneLighting mode={lightingMode} areaId={currentArea.id} />
            {selectedRoomIndex === null ? (
                <HubScene roomOptions={roomOptions} onEnterRoom={onEnterRoom} />
            ) : (
                <RoomScene room={currentArea} onReturnToHub={onReturnToHub} />
            )}
        </>
    )
}

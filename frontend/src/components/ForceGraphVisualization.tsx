import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import * as THREE from 'three';
import { forceX, forceY, forceZ } from 'd3-force-3d';
import { useTheme } from '../contexts/ThemeContext';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ForceGraphRef = any;

// Color palette for entity types
const colorPalette = [
  '#206bc4', '#2fb344', '#f76707', '#d63939', '#ae3ec9',
  '#0ca678', '#4263eb', '#f59f00', '#74b816', '#fa5252',
  '#7950f2', '#15aabf', '#e64980', '#fab005', '#12b886',
];

const defaultColor = '#667382';
const highlightColor = '#ffab00';

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  group_id?: string;
  summary?: string;
  labels?: string[];
  created_at?: string;
  attributes?: Record<string, unknown>;
  // Force graph properties
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  fact?: string;
  uuid?: string;
  created_at?: string;
  valid_at?: string | null;
  expired_at?: string | null;
  episodes?: string[];
  // Internal index for highlighting
  index?: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
}

interface ForceGraphVisualizationProps {
  graphData: GraphData | null;
  onNodeClick?: (node: GraphNode) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
  onBackgroundClick?: () => void;
  highlightedNodes?: Set<string>;
  highlightedEdges?: Set<number>;
  // Layout parameters
  linkDistance?: number;
  chargeStrength?: number;
  centerStrength?: number;
  nodeSize?: number;
  curveSpacing?: number;
  // Label visibility thresholds
  nodeLabelZoom?: number;
  edgeLabelZoom?: number;
  showLabels?: boolean;
}

// Format edge type from UPPER_SNAKE_CASE to Title Case
function formatEdgeType(type: string): string {
  if (!type) return '';
  return type
    .toLowerCase()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function ForceGraphVisualization({
  graphData,
  onNodeClick,
  onEdgeClick,
  onBackgroundClick,
  highlightedNodes = new Set(),
  highlightedEdges = new Set(),
  linkDistance = 150,
  chargeStrength = -800,
  centerStrength = 50,
  nodeSize = 12,
  curveSpacing = 50,
  nodeLabelZoom = 1.5,
  edgeLabelZoom = 2.5,
  showLabels = true,
}: ForceGraphVisualizationProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const graphRef2D = useRef<ForceGraphRef>(null);
  const graphRef3D = useRef<ForceGraphRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [is3D, setIs3D] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // 3D label visibility tracking
  const animationFrameRef = useRef<number | null>(null);
  // Store values in refs so animation loop always has current values
  const nodeLabelZoomRef = useRef(nodeLabelZoom);
  const edgeLabelZoomRef = useRef(edgeLabelZoom);
  const showLabelsRef = useRef(showLabels);
  const highlightedNodesRef = useRef(highlightedNodes);
  const highlightedEdgesRef = useRef(highlightedEdges);
  nodeLabelZoomRef.current = nodeLabelZoom;
  edgeLabelZoomRef.current = edgeLabelZoom;
  showLabelsRef.current = showLabels;
  highlightedNodesRef.current = highlightedNodes;
  highlightedEdgesRef.current = highlightedEdges;

  // Right-click panning state for 2D
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const centerStartRef = useRef({ x: 0, y: 0 });

  // Build type color map
  const typeColors = useMemo(() => {
    if (!graphData) return {};
    const types = [...new Set(graphData.nodes.map(n => n.type))].filter(Boolean).sort();
    const colors: Record<string, string> = {};
    types.forEach((type, index) => {
      colors[type] = colorPalette[index % colorPalette.length];
    });
    return colors;
  }, [graphData]);

  const getNodeColor = useCallback((node: GraphNode) => {
    if (highlightedNodes.has(node.id)) {
      return highlightColor;
    }
    return typeColors[node.type] || defaultColor;
  }, [typeColors, highlightedNodes]);

  // 2D link color (more transparent)
  const getLinkColor2D = useCallback((link: GraphEdge) => {
    const idx = typeof link.index === 'number' ? link.index : -1;
    if (highlightedEdges.has(idx)) {
      return highlightColor;
    }
    return isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
  }, [highlightedEdges, isDark]);

  // 3D link color (less transparent for better visibility)
  const getLinkColor3D = useCallback((link: GraphEdge) => {
    const idx = typeof link.index === 'number' ? link.index : -1;
    if (highlightedEdges.has(idx)) {
      return highlightColor;
    }
    return isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)';
  }, [highlightedEdges, isDark]);

  // Particle color (transparent)
  const getParticleColor = useCallback((link: GraphEdge) => {
    const idx = typeof link.index === 'number' ? link.index : -1;
    if (highlightedEdges.has(idx)) {
      return 'rgba(255,171,0,0.6)'; // Highlight color with transparency
    }
    return isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
  }, [highlightedEdges, isDark]);

  const getLinkWidth = useCallback((link: GraphEdge) => {
    const idx = typeof link.index === 'number' ? link.index : -1;
    return highlightedEdges.has(idx) ? 3 : 1;
  }, [highlightedEdges]);

  // Handle container resize
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Smooth 3D label visibility update using requestAnimationFrame (no React re-renders)
  useEffect(() => {
    if (!is3D) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const updateLabelVisibility = () => {
      const fg = graphRef3D.current;
      if (!fg) {
        animationFrameRef.current = requestAnimationFrame(updateLabelVisibility);
        return;
      }

      const camera = fg.camera();
      const scene = fg.scene();
      if (!camera || !scene) {
        animationFrameRef.current = requestAnimationFrame(updateLabelVisibility);
        return;
      }

      const camPos = camera.position;

      // Read current values from refs (always up-to-date)
      const nodeZoom = nodeLabelZoomRef.current;
      const edgeZoom = edgeLabelZoomRef.current;
      const showLbls = showLabelsRef.current;

      // Threshold: higher slider = need to be closer (smaller distance)
      // nodeLabelZoom 1 = show from distance 1000, nodeLabelZoom 5 = show from distance 600
      const nodeThreshold = (11 - nodeZoom) * 100;
      const edgeThreshold = (11 - edgeZoom) * 100;

      // Reusable Vector3 for world position calculation
      const worldPos = new THREE.Vector3();

      // Get highlighted sets from refs
      const hlNodes = highlightedNodesRef.current;
      const hlEdges = highlightedEdgesRef.current;

      // Traverse the scene to find all SpriteText objects
      scene.traverse((obj: any) => {
        // SpriteText has a 'text' property and is a Sprite
        if (obj.isSprite && obj.text !== undefined) {
          // Check if this sprite is for a highlighted item
          const nodeId = obj.__nodeId;
          const edgeIdx = obj.__edgeIndex;
          const isHighlighted = (nodeId && hlNodes.has(nodeId)) || (edgeIdx !== undefined && edgeIdx >= 0 && hlEdges.has(edgeIdx));

          // Always show highlighted labels
          if (isHighlighted) {
            obj.visible = showLbls;
            return;
          }

          // Get world position for distance check
          obj.getWorldPosition(worldPos);
          const dist = Math.sqrt(
            (worldPos.x - camPos.x) ** 2 +
            (worldPos.y - camPos.y) ** 2 +
            (worldPos.z - camPos.z) ** 2
          );

          // Use edge threshold for smaller text (edge labels), node threshold for larger
          const threshold = obj.textHeight <= 3 ? edgeThreshold : nodeThreshold;
          obj.visible = showLbls && dist < threshold;
        }
      });

      animationFrameRef.current = requestAnimationFrame(updateLabelVisibility);
    };

    animationFrameRef.current = requestAnimationFrame(updateLabelVisibility);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [is3D]); // Only depend on is3D - threshold values read from refs

  // Update forces when parameters change
  useEffect(() => {
    const fg = is3D ? graphRef3D.current : graphRef2D.current;
    if (!fg) return;

    // Use timeout for 3D to ensure engine is ready
    const updateForces = () => {
      try {
        const linkForce = fg.d3Force?.('link');
        const chargeForce = fg.d3Force?.('charge');
        if (linkForce) linkForce.distance(linkDistance);
        if (chargeForce) chargeForce.strength(chargeStrength);

        // Add centering forces (gravity) to keep nodes from drifting too far
        // Strength is normalized: centerStrength 0-200 maps to 0-0.2
        const gravityStrength = centerStrength / 1000;
        fg.d3Force?.('gravityX', forceX(0).strength(gravityStrength));
        fg.d3Force?.('gravityY', forceY(0).strength(gravityStrength));
        // Add Z-axis gravity for 3D mode
        if (is3D) {
          fg.d3Force?.('gravityZ', forceZ(0).strength(gravityStrength));
        }

        fg.d3ReheatSimulation?.();
      } catch {
        // Simulation not ready yet, ignore
      }
    };

    if (is3D) {
      // 3D needs delay for engine initialization
      const timer = setTimeout(updateForces, 200);
      return () => clearTimeout(timer);
    } else {
      updateForces();
    }
  }, [linkDistance, chargeStrength, centerStrength, is3D]);

  // Handle node click
  const handleNodeClick = useCallback((node: GraphNode) => {
    onNodeClick?.(node);
  }, [onNodeClick]);

  // Handle link click
  const handleLinkClick = useCallback((link: GraphEdge) => {
    onEdgeClick?.(link);
  }, [onEdgeClick]);

  // Handle background click
  const handleBackgroundClick = useCallback(() => {
    onBackgroundClick?.();
  }, [onBackgroundClick]);

  // 2D node canvas rendering
  const paintNode2D = useCallback((node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const color = getNodeColor(node);
    const size = nodeSize;
    const isHighlighted = highlightedNodes.has(node.id);

    // Draw node circle
    ctx.beginPath();
    ctx.arc(node.x || 0, node.y || 0, size, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();

    // Draw border for highlighted nodes
    if (isHighlighted) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw label if highlighted OR zoom is sufficient
    if (showLabels && (isHighlighted || globalScale >= nodeLabelZoom)) {
      const label = node.name || node.id;
      const fontSize = Math.max(10, 12 / globalScale);
      ctx.font = `${fontSize}px Sans-Serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isDark ? '#fff' : '#000';
      ctx.fillText(label, node.x || 0, (node.y || 0) + size + fontSize);
    }
  }, [getNodeColor, nodeSize, highlightedNodes, showLabels, nodeLabelZoom, isDark]);

  // 2D link label rendering (library draws the lines, we just add labels)
  const paintLinkLabel2D = useCallback((link: GraphEdge, ctx: CanvasRenderingContext2D, globalScale: number) => {
    if (!showLabels || !link.type) return;

    const idx = typeof link.index === 'number' ? link.index : -1;
    const isHighlighted = highlightedEdges.has(idx);

    // Only draw labels if highlighted OR zoom is sufficient
    if (!isHighlighted && globalScale < edgeLabelZoom) return;

    const source = link.source as GraphNode;
    const target = link.target as GraphNode;
    if (!source.x || !source.y || !target.x || !target.y) return;

    const curvature = (link as any).curvature || 0;

    // Calculate label position
    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;

    let labelX = midX;
    let labelY = midY;

    if (curvature !== 0) {
      // Match the library's curve calculation for label positioning
      const dx = target.x - source.x;
      const dy = target.y - source.y;

      // Library uses: perpendicular offset = curvature * distance
      // Control point for quadratic bezier
      const cpX = midX + curvature * dy;
      const cpY = midY - curvature * dx;

      // Label at curve midpoint (t=0.5 on quadratic bezier)
      labelX = 0.25 * source.x + 0.5 * cpX + 0.25 * target.x;
      labelY = 0.25 * source.y + 0.5 * cpY + 0.25 * target.y;
    }

    const label = formatEdgeType(link.type);
    const fontSize = Math.max(8, 10 / globalScale);

    ctx.font = `${fontSize}px Sans-Serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
    ctx.fillText(label, labelX, labelY);
  }, [showLabels, edgeLabelZoom, isDark, highlightedEdges]);

  // 3D node object (sprite text for labels) - visibility controlled by animation loop
  const nodeThreeObject = useCallback((node: GraphNode): object | null => {
    const sprite = new SpriteText(node.name || node.id);
    sprite.color = isDark ? '#fff' : '#000';
    sprite.textHeight = 4;
    sprite.backgroundColor = isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)';
    sprite.padding = 1;
    sprite.borderRadius = 2;
    // Position below node (negative Y in 3D space)
    (sprite as any).position.y = -(nodeSize * 0.5 + 8);
    // Store node ID for highlight checking
    (sprite as any).__nodeId = node.id;
    return sprite;
  }, [isDark, nodeSize]);

  // 3D link object (sprite text for labels) - visibility controlled by animation loop
  const linkThreeObject = useCallback((link: GraphEdge): object | null => {
    if (!link.type) return null;

    const sprite = new SpriteText(formatEdgeType(link.type));
    sprite.color = isDark ? '#ccc' : '#444';
    sprite.textHeight = 3;
    sprite.backgroundColor = isDark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)';
    sprite.padding = 1;
    sprite.borderRadius = 2;
    // Store edge index for highlight checking
    (sprite as any).__edgeIndex = typeof link.index === 'number' ? link.index : -1;
    return sprite;
  }, [isDark]);

  // Position link labels at midpoint, offset by curvature
  const linkPositionUpdate = useCallback((sprite: any, { start, end }: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }, link: any) => {
    if (!sprite) return;

    // Calculate midpoint
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    const midZ = (start.z + end.z) / 2;

    // If link has curvature, offset label perpendicular to the line
    const curvature = link?.curvature || 0;
    if (curvature !== 0) {
      // Calculate perpendicular offset in 3D
      // Direction vector from start to end
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const dz = end.z - start.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

      // react-force-graph-3d curves bend perpendicular to link in a plane
      // Cross product of link direction with Z-axis [0,0,1] gives horizontal perpendicular
      // Cross: (dx,dy,dz) × (0,0,1) = (dy*1 - dz*0, dz*0 - dx*1, dx*0 - dy*0) = (dy, -dx, 0)
      let perpX = dy;
      let perpY = -dx;
      let perpZ = 0;

      // Normalize the perpendicular vector
      const perpLen = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
      perpX /= perpLen;
      perpY /= perpLen;

      // If link is nearly vertical (perpLen small), use different reference
      if (perpLen < 0.1) {
        // Cross with X-axis instead: (dx,dy,dz) × (1,0,0) = (0, dz, -dy)
        perpX = 0;
        perpY = dz / len;
        perpZ = -dy / len;
      }

      // Offset magnitude based on curvature and distance
      const offset = curvature * len * 0.25;

      sprite.position.x = midX + perpX * offset;
      sprite.position.y = midY + perpY * offset;
      sprite.position.z = midZ + perpZ * offset;
    } else {
      sprite.position.x = midX;
      sprite.position.y = midY;
      sprite.position.z = midZ;
    }
  }, []);

  // Process graph data to add edge indices and curvature for multiple edges
  const processedGraphData = useMemo(() => {
    if (!graphData) return null;

    // Count links between same node pairs for curvature calculation
    const linkCounts: Record<string, number> = {};
    const linkIndices: Record<string, number> = {};

    const processedLinks = graphData.links.map((link, index) => {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      // Create sorted pair key for grouping, but track if this edge is "reversed"
      const sorted = [sourceId, targetId].sort();
      const pairKey = sorted.join('|');
      const isReversed = sorted[0] !== sourceId; // true if actual direction differs from sorted

      if (!linkCounts[pairKey]) {
        linkCounts[pairKey] = 0;
        linkIndices[pairKey] = 0;
      }
      linkCounts[pairKey]++;

      return { ...link, index, pairKey, isReversed };
    });

    // Second pass: assign curvature based on count
    // For odd count: middle edge is straight, others curved
    // For even count: all curved in pairs
    const baseCurvature = curveSpacing / 100; // Convert slider value (0-100) to curvature (0-1)

    const linksWithCurvature = processedLinks.map((link) => {
      const count = linkCounts[link.pairKey];
      let curvature = 0;

      if (count > 1) {
        const idx = linkIndices[link.pairKey]++;
        const isOddCount = count % 2 === 1;
        const middleIdx = Math.floor(count / 2);

        if (isOddCount && idx === middleIdx) {
          // Middle edge of odd count stays straight
          curvature = 0;
        } else {
          // Calculate offset from middle
          let offset: number;
          if (isOddCount) {
            // For odd: skip middle, offset from it
            offset = idx < middleIdx ? middleIdx - idx : idx - middleIdx;
          } else {
            // For even: pair up from center
            offset = Math.floor(Math.abs(idx - (count - 1) / 2)) + 0.5;
          }

          curvature = baseCurvature * offset;

          // Alternate direction based on which side of middle
          if (isOddCount) {
            if (idx < middleIdx) curvature *= -1;
          } else {
            if (idx % 2 === 0) curvature *= -1;
          }
        }
      }

      // Flip curvature if edge direction is reversed from sorted order
      // This ensures curves bend consistently regardless of source/target order
      if (link.isReversed) {
        curvature *= -1;
      }

      return { ...link, curvature };
    });

    return {
      nodes: graphData.nodes,
      links: linksWithCurvature,
    };
  }, [graphData, curveSpacing]);

  if (!processedGraphData) {
    return (
      <div ref={containerRef} className="w-100 h-100 d-flex align-items-center justify-content-center">
        <span className="text-secondary">No graph data</span>
      </div>
    );
  }

  const commonProps = {
    graphData: processedGraphData,
    width: dimensions.width,
    height: dimensions.height,
    nodeId: 'id' as const,
    nodeLabel: (node: GraphNode) => `${node.name}\n(${node.type})`,
    nodeColor: getNodeColor,
    nodeRelSize: nodeSize,
    linkSource: 'source' as const,
    linkTarget: 'target' as const,
    linkWidth: getLinkWidth,
    linkCurvature: (link: any) => link.curvature || 0,
    linkDirectionalParticles: 4,
    linkDirectionalParticleSpeed: 0.004,
    onNodeClick: handleNodeClick,
    onLinkClick: handleLinkClick,
    onBackgroundClick: handleBackgroundClick,
    cooldownTicks: 200,
    warmupTicks: 100,
    backgroundColor: isDark ? '#1a1a2e' : '#f8fafc',
  };

  // 2D-specific props
  const props2D = {
    ...commonProps,
    d3VelocityDecay: 0.4,
    linkColor: getLinkColor2D,
    linkDirectionalParticleWidth: 2,
    linkDirectionalParticleColor: getParticleColor,
  };

  // 3D-specific props
  // Node size scaled down for 3D (appears larger due to perspective)
  // Particles smaller and transparent
  const props3D = {
    ...commonProps,
    nodeRelSize: nodeSize * 0.5,
    linkColor: getLinkColor3D,
    linkDirectionalParticleWidth: 1,
    linkDirectionalParticleColor: getParticleColor,
  };

  // Handle zoom to fit (middle mouse button)
  const handleZoomToFit = useCallback(() => {
    const fg = is3D ? graphRef3D.current : graphRef2D.current;
    if (fg) {
      fg.zoomToFit?.(400, 0);

      // For 3D, zoom in after fit completes
      if (is3D) {
        setTimeout(() => {
          const camera = fg.camera();
          if (camera) {
            // Move camera 50% closer to origin
            camera.position.multiplyScalar(0.5);
          }
        }, 450);
      }
    }
  }, [is3D]);

  // Handle mouse down - middle button for zoom fit, right button for pan start (2D only)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) { // Middle mouse button
      e.preventDefault();
      handleZoomToFit();
    } else if (e.button === 2 && !is3D) { // Right mouse button - start panning in 2D
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      const fg = graphRef2D.current;
      if (fg) {
        const center = fg.centerAt();
        centerStartRef.current = { x: center?.x || 0, y: center?.y || 0 };
      }
    }
  }, [handleZoomToFit, is3D]);

  // Handle mouse move - pan in 2D when right-click dragging
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current || is3D) return;

    const fg = graphRef2D.current;
    if (!fg) return;

    const zoom = fg.zoom();
    const dx = (e.clientX - panStartRef.current.x) / zoom;
    const dy = (e.clientY - panStartRef.current.y) / zoom;

    fg.centerAt(
      centerStartRef.current.x - dx,
      centerStartRef.current.y - dy
    );
  }, [is3D]);

  // Handle mouse up - stop panning
  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  // Prevent context menu to allow right-click panning
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-100 h-100 position-relative"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      {/* Navigation Hints (bottom center) */}
      <div className="position-absolute bottom-0 start-50 translate-middle-x mb-2 z-3">
        <div className="d-flex gap-3 px-3 py-1 rounded" style={{ backgroundColor: 'rgba(0,0,0,0.5)', fontSize: '0.75rem', color: 'rgba(255,255,255,0.8)' }}>
          <span>🖱️ Left: {is3D ? 'Rotate' : 'Select'}</span>
          <span>🖱️ Right: Pan</span>
          <span>⚙️ Wheel: Zoom</span>
          <span>🖱️ Middle: Fit All</span>
        </div>
      </div>

      {/* 2D/3D Toggle (bottom right) */}
      <div className="position-absolute bottom-0 end-0 m-2 z-3">
        <div className="btn-group btn-group-sm" role="group">
          <button
            type="button"
            className={`btn ${!is3D ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => setIs3D(false)}
          >
            2D
          </button>
          <button
            type="button"
            className={`btn ${is3D ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => setIs3D(true)}
          >
            3D
          </button>
        </div>
      </div>

      {/* Graph Renderer */}
      {is3D ? (
        <ForceGraph3D
          ref={graphRef3D}
          {...(props3D as any)}
          showNavInfo={false}
          nodeThreeObject={nodeThreeObject as any}
          nodeThreeObjectExtend={true}
          linkThreeObject={linkThreeObject as any}
          linkThreeObjectExtend={true}
          linkPositionUpdate={linkPositionUpdate}
        />
      ) : (
        <ForceGraph2D
          ref={graphRef2D}
          {...(props2D as any)}
          nodeCanvasObject={paintNode2D as any}
          nodeCanvasObjectMode={() => 'replace'}
          linkCanvasObject={paintLinkLabel2D as any}
          linkCanvasObjectMode={() => 'after'}
        />
      )}
    </div>
  );
}

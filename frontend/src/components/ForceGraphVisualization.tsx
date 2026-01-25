import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { ForceGraph2D, ForceGraph3D } from 'react-force-graph';
import SpriteText from 'three-spritetext';
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
  selectedNode?: GraphNode | null;
  selectedEdge?: GraphEdge | null;
  // Layout parameters
  linkDistance?: number;
  chargeStrength?: number;
  nodeSize?: number;
  // Label visibility thresholds
  nodeLabelZoom?: number;
  edgeLabelZoom?: number;
  showLabels?: boolean;
  // Callbacks for edge creation via shift+drag
  onEdgeDragStart?: (sourceNode: GraphNode) => void;
  onEdgeDragEnd?: (sourceNode: GraphNode, targetNode: GraphNode | null) => void;
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
  nodeSize = 12,
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
  const [currentZoom, setCurrentZoom] = useState(1);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

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

  const getLinkColor = useCallback((link: GraphEdge) => {
    const idx = typeof link.index === 'number' ? link.index : -1;
    if (highlightedEdges.has(idx)) {
      return highlightColor;
    }
    return isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)';
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

  // Update forces when parameters change
  useEffect(() => {
    const fg = is3D ? graphRef3D.current : graphRef2D.current;
    if (!fg) return;

    fg.d3Force('link')?.distance(linkDistance);
    fg.d3Force('charge')?.strength(chargeStrength);
    fg.d3ReheatSimulation();
  }, [linkDistance, chargeStrength, is3D]);

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

    // Draw label if zoom is sufficient
    if (showLabels && globalScale >= nodeLabelZoom) {
      const label = node.name || node.id;
      const fontSize = Math.max(10, 12 / globalScale);
      ctx.font = `${fontSize}px Sans-Serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isDark ? '#fff' : '#000';
      ctx.fillText(label, node.x || 0, (node.y || 0) + size + fontSize);
    }
  }, [getNodeColor, nodeSize, highlightedNodes, showLabels, nodeLabelZoom, isDark]);

  // 2D link canvas rendering with labels
  const paintLink2D = useCallback((link: GraphEdge, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const source = link.source as GraphNode;
    const target = link.target as GraphNode;
    if (!source.x || !source.y || !target.x || !target.y) return;

    const idx = typeof link.index === 'number' ? link.index : -1;
    const isHighlighted = highlightedEdges.has(idx);

    // Draw link line
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.strokeStyle = getLinkColor(link);
    ctx.lineWidth = isHighlighted ? 3 : 1;
    ctx.stroke();

    // Draw label if zoom is sufficient
    if (showLabels && globalScale >= edgeLabelZoom && link.type) {
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;
      const label = formatEdgeType(link.type);
      const fontSize = Math.max(8, 10 / globalScale);

      ctx.font = `${fontSize}px Sans-Serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
      ctx.fillText(label, midX, midY);
    }
  }, [getLinkColor, highlightedEdges, showLabels, edgeLabelZoom, isDark]);

  // 3D node object (sprite text for labels)
  const nodeThreeObject = useCallback((node: GraphNode): object | null => {
    if (!showLabels || currentZoom < nodeLabelZoom) return null;

    const sprite = new SpriteText(node.name || node.id);
    sprite.color = getNodeColor(node);
    sprite.textHeight = 6;
    // Position label above node
    (sprite as any).position.y = nodeSize + 8;
    return sprite;
  }, [showLabels, currentZoom, nodeLabelZoom, getNodeColor, nodeSize]);

  // 3D link object (sprite text for labels)
  const linkThreeObject = useCallback((link: GraphEdge): object | null => {
    if (!showLabels || currentZoom < edgeLabelZoom || !link.type) return null;

    const sprite = new SpriteText(formatEdgeType(link.type));
    sprite.color = isDark ? '#aaa' : '#666';
    sprite.textHeight = 4;
    return sprite;
  }, [showLabels, currentZoom, edgeLabelZoom, isDark]);

  // Position link labels at midpoint
  const linkPositionUpdate = useCallback((sprite: any, { start, end }: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }) => {
    if (!sprite) return;
    const middle = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
      z: (start.z + end.z) / 2,
    };
    Object.assign(sprite.position, middle);
  }, []);

  // Process graph data to add edge indices
  const processedGraphData = useMemo(() => {
    if (!graphData) return null;
    return {
      nodes: graphData.nodes,
      links: graphData.links.map((link, index) => ({ ...link, index })),
    };
  }, [graphData]);

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
    linkColor: getLinkColor,
    linkWidth: getLinkWidth,
    linkCurvature: 0.2,
    linkDirectionalParticles: 4,
    linkDirectionalParticleSpeed: 0.004,
    linkDirectionalParticleWidth: 2,
    linkDirectionalParticleColor: getLinkColor,
    onNodeClick: handleNodeClick,
    onLinkClick: handleLinkClick,
    onBackgroundClick: handleBackgroundClick,
    cooldownTicks: 100,
    warmupTicks: 50,
    backgroundColor: isDark ? '#1a1a2e' : '#f8fafc',
  };

  return (
    <div ref={containerRef} className="w-100 h-100 position-relative">
      {/* 2D/3D Toggle */}
      <div className="position-absolute top-0 end-0 m-2 z-3">
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
          {...(commonProps as any)}
          nodeThreeObject={nodeThreeObject as any}
          nodeThreeObjectExtend={true}
          linkThreeObject={linkThreeObject as any}
          linkThreeObjectExtend={true}
          linkPositionUpdate={linkPositionUpdate}
          onZoom={({ k }: { k: number }) => setCurrentZoom(k)}
        />
      ) : (
        <ForceGraph2D
          ref={graphRef2D}
          {...(commonProps as any)}
          nodeCanvasObject={paintNode2D as any}
          nodeCanvasObjectMode={() => 'replace'}
          linkCanvasObject={paintLink2D as any}
          linkCanvasObjectMode={() => 'replace'}
          onZoom={({ k }: { k: number }) => setCurrentZoom(k)}
        />
      )}
    </div>
  );
}

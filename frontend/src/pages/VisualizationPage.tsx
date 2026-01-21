import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { api } from '../api/client';
import { useTheme } from '../contexts/ThemeContext';
import { IconRefresh, IconTrash } from '@tabler/icons-react';

interface Node {
  id: string;
  name: string;
  type: string;
  group_id?: string;
  summary?: string;
  labels?: string[];
  created_at?: string;
  attributes?: Record<string, any>;
  // D3 simulation properties
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface Edge {
  source: string | Node;
  target: string | Node;
  type: string;
  fact?: string;
  // For curved edges - index among edges between same nodes
  linkIndex?: number;
  linkCount?: number;
  originalIndex?: number;
}

interface GraphData {
  nodes: Node[];
  edges: Edge[];
}

// Color palette for entity types
const colorPalette = [
  '#206bc4', '#2fb344', '#f76707', '#d63939', '#ae3ec9',
  '#0ca678', '#4263eb', '#f59f00', '#74b816', '#fa5252',
  '#7950f2', '#15aabf', '#e64980', '#fab005', '#12b886',
];

const defaultColor = '#667382';
const highlightColor = '#206bc4';

export function VisualizationPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
  const [highlightedEdges, setHighlightedEdges] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(500);
  const [groups, setGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [isDeleting, setIsDeleting] = useState(false);

  // Refs for D3 selections to update highlighting without re-running simulation
  const nodeSelectionRef = useRef<d3.Selection<SVGGElement, Node, SVGGElement, unknown> | null>(null);
  const linkSelectionRef = useRef<d3.Selection<SVGPathElement, Edge, SVGGElement, unknown> | null>(null);
  const edgeLabelSelectionRef = useRef<d3.Selection<SVGGElement, Edge, SVGGElement, unknown> | null>(null);
  const themeColorsRef = useRef<{ isDark: boolean; linkColor: string; linkHighlightColor: string }>({
    isDark: false,
    linkColor: '#cbd5e0',
    linkHighlightColor: highlightColor,
  });
  const autoFitDoneRef = useRef(false);

  // Extract unique types from visible nodes and build color map (memoized)
  const nodeTypes = useMemo(() =>
    graphData
      ? [...new Set(graphData.nodes.map(n => n.type))].filter(Boolean).sort()
      : [],
    [graphData]
  );

  const typeColors = useMemo(() => {
    const colors: Record<string, string> = {};
    nodeTypes.forEach((type, index) => {
      colors[type] = colorPalette[index % colorPalette.length];
    });
    return colors;
  }, [nodeTypes]);

  const handleDeleteGraph = async () => {
    if (!selectedGroup) return;
    if (!confirm(`Are you sure you want to delete the graph "${selectedGroup}"?\n\nThis will permanently delete all nodes and edges in this graph.`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const response = await api.delete(`/graph/group/${selectedGroup}`);
      if (response.data.success) {
        setGroups(groups.filter(g => g !== selectedGroup));
        setSelectedGroup('');
        setLimit(prev => prev);
      } else {
        alert(`Failed to delete graph: ${response.data.error}`);
      }
    } catch (err: any) {
      alert(`Error deleting graph: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Get color for a type
  const getTypeColor = (type: string) => typeColors[type] || defaultColor;

  // Handle node click - highlight connected nodes and edges
  const handleNodeClick = useCallback((node: Node, edges: Edge[]) => {
    setSelectedNode(node);
    setSelectedEdge(null);

    const connectedNodes = new Set<string>([node.id]);
    const connectedEdgeIndices = new Set<number>();

    edges.forEach((edge, index) => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;

      if (sourceId === node.id || targetId === node.id) {
        connectedNodes.add(sourceId);
        connectedNodes.add(targetId);
        connectedEdgeIndices.add(index);
      }
    });

    setHighlightedNodes(connectedNodes);
    setHighlightedEdges(connectedEdgeIndices);
  }, []);

  // Handle edge click - highlight source and target nodes
  const handleEdgeClick = useCallback((edge: Edge, edgeIndex: number) => {
    setSelectedEdge(edge);
    setSelectedNode(null);

    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;

    setHighlightedNodes(new Set([sourceId, targetId]));
    setHighlightedEdges(new Set([edgeIndex]));
  }, []);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setHighlightedNodes(new Set());
    setHighlightedEdges(new Set());
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: limit.toString() });
        if (selectedGroup) params.append('group_id', selectedGroup);

        const response = await api.get(`/graph/data?${params}`);
        setGraphData(response.data);

        const uniqueGroups = [...new Set(response.data.nodes.map((n: Node) => n.group_id).filter(Boolean))];
        setGroups(uniqueGroups as string[]);
      } catch (err: any) {
        setError(err.response?.data?.detail || 'Failed to load graph data');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [limit, selectedGroup]);

  useEffect(() => {
    if (!graphData || !svgRef.current || !containerRef.current) return;

    // Reset auto-fit flag for new data
    autoFitDoneRef.current = false;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    // Create main group for zoom/pan
    const g = svg.append('g');

    // Setup zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Click on background to clear selection
    svg.on('click', (event) => {
      if (event.target === svgRef.current) {
        clearSelection();
      }
    });

    const isDark = theme === 'dark';
    const linkColor = isDark ? '#4a5568' : '#cbd5e0';
    const linkHighlightColor = highlightColor;
    const textColor = isDark ? '#f8fafc' : '#182433';
    const bgColor = isDark ? '#182433' : '#f8fafc';
    const labelBgColor = isDark ? 'rgba(24, 36, 51, 0.9)' : 'rgba(255, 255, 255, 0.9)';

    svg.style('background', bgColor);

    // Process edges - count links between same node pairs for curve offset
    const linkCounts: Record<string, number> = {};
    const processedEdges = graphData.edges.map((edge, i) => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const key = [sourceId, targetId].sort().join('-');

      if (!linkCounts[key]) linkCounts[key] = 0;
      const linkIndex = linkCounts[key]++;

      return { ...edge, linkIndex, originalIndex: i };
    });

    // Add final link counts
    processedEdges.forEach(edge => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target.id;
      const key = [sourceId, targetId].sort().join('-');
      edge.linkCount = linkCounts[key];
    });

    // Create simulation with improved physics
    const simulation = d3.forceSimulation(graphData.nodes as d3.SimulationNodeDatum[])
      .force('link', d3.forceLink(processedEdges)
        .id((d: any) => d.id)
        .distance(150)
        .strength(0.3))
      .force('charge', d3.forceManyBody()
        .strength(-800)
        .distanceMin(20)
        .distanceMax(400))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.05))
      .force('collision', d3.forceCollide().radius(40).strength(0.5))
      .velocityDecay(0.4)
      .alphaDecay(0.02);

    // Arrow marker for directed edges
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M 0,-5 L 10,0 L 0,5')
      .attr('fill', linkColor);

    // Highlighted arrow marker
    svg.select('defs').append('marker')
      .attr('id', 'arrowhead-highlight')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M 0,-5 L 10,0 L 0,5')
      .attr('fill', linkHighlightColor);

    // Store theme colors in ref for highlighting effect
    themeColorsRef.current = { isDark, linkColor, linkHighlightColor };

    // Create edge paths (curved)
    const linkGroup = g.append('g').attr('class', 'links');

    const link = linkGroup.selectAll('path')
      .data(processedEdges)
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', linkColor)
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6)
      .attr('marker-end', 'url(#arrowhead)')
      .style('cursor', 'pointer')
      .on('click', (event, d: any) => {
        event.stopPropagation();
        handleEdgeClick(d, d.originalIndex);
      });

    // Store link selection in ref
    linkSelectionRef.current = link as any;

    // Create edge labels
    const edgeLabelGroup = g.append('g').attr('class', 'edge-labels');

    const edgeLabels = edgeLabelGroup.selectAll('g')
      .data(processedEdges)
      .join('g')
      .style('cursor', 'pointer')
      .on('click', (event, d: any) => {
        event.stopPropagation();
        handleEdgeClick(d, d.originalIndex);
      });

    // Store edge label selection in ref
    edgeLabelSelectionRef.current = edgeLabels as any;

    // Label background
    edgeLabels.append('rect')
      .attr('fill', labelBgColor)
      .attr('rx', 3)
      .attr('ry', 3);

    // Label text
    edgeLabels.append('text')
      .text((d: any) => d.type || '')
      .attr('font-size', '9px')
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .attr('fill', textColor)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle');

    // Create node groups
    const nodeGroup = g.append('g').attr('class', 'nodes');

    const node = nodeGroup.selectAll<SVGGElement, Node>('g')
      .data(graphData.nodes)
      .join('g')
      .style('cursor', 'pointer')
      .call(d3.drag<SVGGElement, Node>()
        .on('start', (event, d: any) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d: any) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d: any) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }) as any);

    // Store node selection in ref
    nodeSelectionRef.current = node;

    // Node circles with drop shadow
    node.append('circle')
      .attr('r', 12)
      .attr('fill', (d: Node) => getTypeColor(d.type))
      .attr('stroke', isDark ? '#182433' : '#ffffff')
      .attr('stroke-width', 2)
      .attr('filter', 'drop-shadow(0 2px 3px rgba(0,0,0,0.2))')
      .on('click', (event, d: Node) => {
        event.stopPropagation();
        handleNodeClick(d, processedEdges);
      });

    // Node labels
    node.append('text')
      .text((d: Node) => d.name?.substring(0, 20) || d.id.substring(0, 8))
      .attr('x', 16)
      .attr('y', 4)
      .attr('fill', textColor)
      .attr('font-size', '11px')
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .attr('pointer-events', 'none');

    // Helper function to generate curved path
    function linkPath(d: any): string {
      const source = d.source;
      const target = d.target;

      if (!source.x || !target.x) return '';

      // Self-loop
      if (source.id === target.id) {
        const x = source.x;
        const y = source.y;
        const r = 30;
        return `M ${x - 10} ${y - 10}
                A ${r} ${r} 0 1 1 ${x + 10} ${y - 10}
                A ${r} ${r} 0 0 1 ${x - 10} ${y - 10}`;
      }

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dr = Math.sqrt(dx * dx + dy * dy);

      // Multiple edges between same nodes - curve them
      const linkCount = d.linkCount || 1;
      const linkIndex = d.linkIndex || 0;

      if (linkCount === 1) {
        // Single edge - straight line (or slight curve)
        return `M ${source.x} ${source.y} L ${target.x} ${target.y}`;
      }

      // Multiple edges - create curved paths
      const offset = (linkIndex - (linkCount - 1) / 2) * 30;
      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;

      // Perpendicular offset
      const nx = -dy / dr;
      const ny = dx / dr;

      const ctrlX = midX + nx * offset;
      const ctrlY = midY + ny * offset;

      return `M ${source.x} ${source.y} Q ${ctrlX} ${ctrlY} ${target.x} ${target.y}`;
    }

    // Helper to get edge label position
    function getLabelPosition(d: any): { x: number; y: number } {
      const source = d.source;
      const target = d.target;

      if (!source.x || !target.x) return { x: 0, y: 0 };

      // Self-loop
      if (source.id === target.id) {
        return { x: source.x, y: source.y - 50 };
      }

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dr = Math.sqrt(dx * dx + dy * dy);

      const linkCount = d.linkCount || 1;
      const linkIndex = d.linkIndex || 0;

      const midX = (source.x + target.x) / 2;
      const midY = (source.y + target.y) / 2;

      if (linkCount === 1) {
        return { x: midX, y: midY };
      }

      const offset = (linkIndex - (linkCount - 1) / 2) * 30;
      const nx = -dy / dr;
      const ny = dx / dr;

      return {
        x: midX + nx * offset * 0.5,
        y: midY + ny * offset * 0.5
      };
    }

    // Simulation tick
    simulation.on('tick', () => {
      // Update link paths
      link.attr('d', linkPath);

      // Update edge labels
      edgeLabels.each(function(d: any) {
        const pos = getLabelPosition(d);
        const text = d3.select(this).select('text');
        const rect = d3.select(this).select('rect');

        text.attr('x', pos.x).attr('y', pos.y);

        // Size the background rect to fit text
        const bbox = (text.node() as SVGTextElement)?.getBBox();
        if (bbox) {
          rect
            .attr('x', bbox.x - 3)
            .attr('y', bbox.y - 1)
            .attr('width', bbox.width + 6)
            .attr('height', bbox.height + 2);
        }
      });

      // Update node positions
      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    // Auto-fit after simulation stabilizes (only once per data load)
    simulation.on('end', () => {
      if (autoFitDoneRef.current) return;
      autoFitDoneRef.current = true;

      // Calculate bounding box of all nodes
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;

      graphData.nodes.forEach((d: any) => {
        if (d.x < minX) minX = d.x;
        if (d.x > maxX) maxX = d.x;
        if (d.y < minY) minY = d.y;
        if (d.y > maxY) maxY = d.y;
      });

      if (minX !== Infinity) {
        const padding = 50;
        const boxWidth = maxX - minX + padding * 2;
        const boxHeight = maxY - minY + padding * 2;

        const scale = Math.min(
          width / boxWidth,
          height / boxHeight,
          1.5 // Max zoom
        ) * 0.9; // Leave some margin

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        const transform = d3.zoomIdentity
          .translate(width / 2, height / 2)
          .scale(scale)
          .translate(-centerX, -centerY);

        svg.transition()
          .duration(750)
          .call(zoom.transform, transform);
      }
    });

    return () => {
      simulation.stop();
    };
  }, [graphData, theme, typeColors, handleNodeClick, handleEdgeClick, clearSelection]);

  // Separate effect for highlighting updates (doesn't restart simulation)
  useEffect(() => {
    const node = nodeSelectionRef.current;
    const link = linkSelectionRef.current;
    const edgeLabels = edgeLabelSelectionRef.current;
    const { isDark, linkColor, linkHighlightColor } = themeColorsRef.current;

    if (!node || !link || !edgeLabels) return;

    // Update node appearance
    node.select('circle')
      .attr('stroke', (d: Node) => highlightedNodes.has(d.id) ? highlightColor : (isDark ? '#182433' : '#ffffff'))
      .attr('stroke-width', (d: Node) => highlightedNodes.has(d.id) ? 3 : 2)
      .attr('opacity', highlightedNodes.size === 0 ? 1 : (d: Node) => highlightedNodes.has(d.id) ? 1 : 0.3);

    node.select('text')
      .attr('opacity', highlightedNodes.size === 0 ? 1 : (d: Node) => highlightedNodes.has(d.id) ? 1 : 0.3);

    // Update edge appearance
    link
      .attr('stroke', (d: any) => highlightedEdges.has(d.originalIndex) ? linkHighlightColor : linkColor)
      .attr('stroke-width', (d: any) => highlightedEdges.has(d.originalIndex) ? 2.5 : 1.5)
      .attr('stroke-opacity', highlightedEdges.size === 0 ? 0.6 : (d: any) => highlightedEdges.has(d.originalIndex) ? 1 : 0.15)
      .attr('marker-end', (d: any) => highlightedEdges.has(d.originalIndex) ? 'url(#arrowhead-highlight)' : 'url(#arrowhead)');

    edgeLabels
      .attr('opacity', highlightedEdges.size === 0 ? 1 : (d: any) => highlightedEdges.has(d.originalIndex) ? 1 : 0.2);
  }, [highlightedNodes, highlightedEdges]);

  return (
    <div className="d-flex flex-column" style={{ height: 'calc(100vh - 2rem)' }}>
      {/* Controls */}
      <div className="card mb-3">
        <div className="card-body py-2">
          <div className="row align-items-center">
            <div className="col-auto">
              <select
                value={selectedGroup}
                onChange={e => setSelectedGroup(e.target.value)}
                className="form-select form-select-sm"
              >
                <option value="">All Groups</option>
                {groups.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            {selectedGroup && (
              <div className="col-auto">
                <button
                  onClick={handleDeleteGraph}
                  disabled={isDeleting}
                  className="btn btn-sm btn-outline-danger"
                  title={`Delete graph "${selectedGroup}"`}
                >
                  <IconTrash size={16} className="me-1" />
                  {isDeleting ? 'Deleting...' : 'Delete Graph'}
                </button>
              </div>
            )}
            <div className="col-auto">
              <select
                value={limit}
                onChange={e => setLimit(Number(e.target.value))}
                className="form-select form-select-sm"
              >
                <option value={100}>100 Nodes</option>
                <option value={250}>250 Nodes</option>
                <option value={500}>500 Nodes</option>
                <option value={1000}>1000 Nodes</option>
              </select>
            </div>
            <div className="col-auto ms-auto text-secondary">
              {graphData && `${graphData.nodes.length} Nodes • ${graphData.edges.length} Edges`}
            </div>
          </div>
        </div>
      </div>

      {/* Graph container */}
      <div ref={containerRef} className="card flex-grow-1 position-relative">
        {isLoading && (
          <div className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center bg-white bg-opacity-75">
            <div className="text-center">
              <div className="spinner-border text-primary" role="status" />
              <p className="mt-3 text-secondary">Loading graph data...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center">
            <div className="text-center">
              <p className="text-danger h4 mb-2">Failed to load graph</p>
              <p className="text-secondary mb-3">{error}</p>
              <button
                onClick={() => setLimit(limit)}
                className="btn btn-primary"
              >
                <IconRefresh size={16} className="me-1" />
                Retry
              </button>
            </div>
          </div>
        )}

        <svg ref={svgRef} className="w-100 h-100" />

        {/* Legend */}
        {nodeTypes.length > 0 && (
          <div className="card position-absolute" style={{ top: '1rem', left: '1rem', width: 'auto', maxHeight: 'calc(100% - 2rem)', overflowY: 'auto' }}>
            <div className="card-body py-2 px-3">
              <h4 className="card-title mb-2">Entity Types</h4>
              {nodeTypes.map((type) => (
                <div key={type} className="d-flex align-items-center gap-2 mb-1">
                  <span className="badge" style={{ backgroundColor: getTypeColor(type), width: '12px', height: '12px', padding: 0 }}></span>
                  <small className="text-secondary">{type}</small>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Node details */}
        {selectedNode && (
          <div className="card position-absolute" style={{ top: '1rem', right: '1rem', width: '380px', maxHeight: 'calc(100% - 2rem)', overflowY: 'auto' }}>
            <div className="card-header d-flex align-items-center">
              <h4 className="card-title mb-0">Node Details</h4>
              <button
                className="btn btn-close ms-auto"
                onClick={clearSelection}
              />
            </div>
            <div className="card-body">
              <h3 className="mb-2">{selectedNode.name || 'Unknown'}</h3>
              <div className="mb-3">
                <span
                  className="badge me-1"
                  style={{ backgroundColor: getTypeColor(selectedNode.type), color: 'white' }}
                >
                  {selectedNode.type}
                </span>
                {selectedNode.labels?.filter(l => l !== 'Entity' && l !== selectedNode.type).map(label => (
                  <span key={label} className="badge bg-secondary me-1">{label}</span>
                ))}
              </div>

              {selectedNode.summary && (
                <div className="mb-3">
                  <label className="form-label text-muted small mb-1">Summary</label>
                  <p className="mb-0 small">{selectedNode.summary}</p>
                </div>
              )}

              {(selectedNode.group_id || selectedNode.created_at) && (
                <div className="mb-3">
                  <label className="form-label text-muted small mb-1">Metadata</label>
                  <table className="table table-sm table-borderless mb-0">
                    <tbody>
                      {selectedNode.group_id && (
                        <tr>
                          <td className="text-muted ps-0" style={{ width: '100px' }}>Graph</td>
                          <td>{selectedNode.group_id}</td>
                        </tr>
                      )}
                      {selectedNode.created_at && (
                        <tr>
                          <td className="text-muted ps-0">Created</td>
                          <td className="small">{new Date(selectedNode.created_at).toLocaleString()}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedNode.attributes && Object.keys(selectedNode.attributes).length > 0 && (
                <div>
                  <label className="form-label text-muted small mb-1">Attributes</label>
                  <table className="table table-sm table-borderless mb-0">
                    <tbody>
                      {Object.entries(selectedNode.attributes).map(([key, value]) => (
                        <tr key={key}>
                          <td className="text-muted ps-0" style={{ width: '100px' }}>{key}</td>
                          <td className="small" style={{ wordBreak: 'break-word' }}>
                            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Edge details */}
        {selectedEdge && (
          <div className="card position-absolute" style={{ top: '1rem', right: '1rem', width: '380px', maxHeight: 'calc(100% - 2rem)', overflowY: 'auto' }}>
            <div className="card-header d-flex align-items-center">
              <h4 className="card-title mb-0">Relationship Details</h4>
              <button
                className="btn btn-close ms-auto"
                onClick={clearSelection}
              />
            </div>
            <div className="card-body">
              {/* Relationship flow visualization */}
              <div className="d-flex align-items-center justify-content-center gap-2 mb-3 p-3 bg-light rounded">
                <span className="badge" style={{ backgroundColor: getTypeColor((selectedEdge.source as Node).type || ''), color: 'white' }}>
                  {(selectedEdge.source as Node).name || 'Source'}
                </span>
                <span className="text-muted">→</span>
                <span className="badge bg-secondary">{selectedEdge.type}</span>
                <span className="text-muted">→</span>
                <span className="badge" style={{ backgroundColor: getTypeColor((selectedEdge.target as Node).type || ''), color: 'white' }}>
                  {(selectedEdge.target as Node).name || 'Target'}
                </span>
              </div>

              <div className="mb-3">
                <label className="form-label text-muted small mb-1">Type</label>
                <p className="mb-0">{selectedEdge.type}</p>
              </div>

              {selectedEdge.fact && (
                <div className="mb-3">
                  <label className="form-label text-muted small mb-1">Fact</label>
                  <p className="mb-0 small">{selectedEdge.fact}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

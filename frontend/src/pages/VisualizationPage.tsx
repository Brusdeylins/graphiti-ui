import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { api } from '../api/client';
import { useTheme } from '../contexts/ThemeContext';
import { ForceGraphVisualization, type GraphNode, type GraphEdge } from '../components/ForceGraphVisualization';
import { IconRefresh, IconTrash, IconPlus, IconEdit, IconX, IconCheck, IconTrashX, IconAdjustments, IconAlertTriangle, IconBrain, IconLink, IconLoader2 } from '@tabler/icons-react';

// CSS for spinning animation and input-group button styling
const visualizationStyles = `
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.spin { animation: spin 1s linear infinite; }

/* Input-group buttons: match form-control border and remove persistent focus state */
.input-group .btn-input-group {
  border-color: var(--tblr-border-color);
  background-color: var(--tblr-bg-surface);
  color: var(--tblr-body-color);
}
.input-group .btn-input-group:hover {
  background-color: var(--tblr-bg-surface-secondary);
  border-color: var(--tblr-border-color);
  color: var(--tblr-body-color);
}
.input-group .btn-input-group:focus {
  box-shadow: none;
  border-color: var(--tblr-border-color);
  background-color: var(--tblr-bg-surface);
}
.input-group .btn-input-group:active {
  background-color: var(--tblr-bg-surface-tertiary);
}
`;

// Inject styles once
if (typeof document !== 'undefined' && !document.getElementById('visualization-spin-styles')) {
  const style = document.createElement('style');
  style.id = 'visualization-spin-styles';
  style.textContent = visualizationStyles;
  document.head.appendChild(style);
}

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
  uuid?: string;
  group_id?: string;
  created_at?: string;
  valid_at?: string | null;
  expired_at?: string | null;
  episodes?: string[];
  // For curved edges - index among edges between same nodes
  linkIndex?: number;
  linkCount?: number;
  originalIndex?: number;
}

interface GraphStats {
  node_count: number;
  edge_count: number;
  episode_count?: number;
  episode_edge_count?: number;
  label_count: number;
}

interface GraphData {
  nodes: Node[];
  edges: Edge[];
  stats?: GraphStats;
}

interface Episode {
  uuid: string;
  name: string;
  content: string;
  source: string;
  source_description: string;
  valid_at: string | null;
  created_at: string;
  group_id: string;
}

interface EntityTypeField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface EntityType {
  name: string;
  description: string;
  fields: EntityTypeField[];
}

interface QueueStatus {
  total_pending: number;
  currently_processing: number;
}

// Color palette for entity types
const colorPalette = [
  '#206bc4', '#2fb344', '#f76707', '#d63939', '#ae3ec9',
  '#0ca678', '#4263eb', '#f59f00', '#74b816', '#fa5252',
  '#7950f2', '#15aabf', '#e64980', '#fab005', '#12b886',
];

const defaultColor = '#667382';

// Format edge type from UPPER_SNAKE_CASE to Title Case
function formatEdgeType(type: string): string {
  if (!type) return '';
  return type
    .toLowerCase()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function VisualizationPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  useTheme(); // Hook needed for theme context
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
  const [highlightedEdges, setHighlightedEdges] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(() => {
    if (typeof window === 'undefined') return 2000;
    const saved = localStorage.getItem('graphiti-limit');
    return saved ? Number(saved) : 2000;
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [groups, setGroups] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [panelWidth, setPanelWidth] = useState(420);
  const [loadedEpisodes, setLoadedEpisodes] = useState<Record<string, Episode>>({});
  const [loadingEpisodes, setLoadingEpisodes] = useState<Set<string>>(new Set());
  const [expandedEpisode, setExpandedEpisode] = useState<string | null>(null);
  const isResizingRef = useRef(false);
  const processedEdgesRef = useRef<Edge[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const prevProcessingRef = useRef<number>(0);

  // Graph layout parameters (with localStorage persistence)
  const LAYOUT_DEFAULTS = {
    linkDistance: 150, chargeStrength: -800, centerStrength: 50, nodeSize: 12, curveSpacing: 50,
    nodeLabelZoom: 1.5, edgeLabelZoom: 2.5
  };
  const loadLayoutSetting = (key: string, defaultValue: number) => {
    if (typeof window === 'undefined') return defaultValue;
    const saved = localStorage.getItem(`graphiti-layout-${key}`);
    return saved ? Number(saved) : defaultValue;
  };
  const [linkDistance, setLinkDistance] = useState(() => loadLayoutSetting('linkDistance', LAYOUT_DEFAULTS.linkDistance));
  const [chargeStrength, setChargeStrength] = useState(() => loadLayoutSetting('chargeStrength', LAYOUT_DEFAULTS.chargeStrength));
  const [centerStrength, setCenterStrength] = useState(() => loadLayoutSetting('centerStrength', LAYOUT_DEFAULTS.centerStrength));
  const [nodeSize, setNodeSize] = useState(() => loadLayoutSetting('nodeSize', LAYOUT_DEFAULTS.nodeSize));
  const [curveSpacing, setCurveSpacing] = useState(() => loadLayoutSetting('curveSpacing', LAYOUT_DEFAULTS.curveSpacing));
  const [nodeLabelZoom, setNodeLabelZoom] = useState(() => loadLayoutSetting('nodeLabelZoom', LAYOUT_DEFAULTS.nodeLabelZoom));
  const [edgeLabelZoom, setEdgeLabelZoom] = useState(() => loadLayoutSetting('edgeLabelZoom', LAYOUT_DEFAULTS.edgeLabelZoom));
  const [showLayoutControls, setShowLayoutControls] = useState(false);

  // Persist layout settings to localStorage
  useEffect(() => {
    localStorage.setItem('graphiti-layout-linkDistance', String(linkDistance));
    localStorage.setItem('graphiti-layout-chargeStrength', String(chargeStrength));
    localStorage.setItem('graphiti-layout-centerStrength', String(centerStrength));
    localStorage.setItem('graphiti-layout-nodeSize', String(nodeSize));
    localStorage.setItem('graphiti-layout-curveSpacing', String(curveSpacing));
    localStorage.setItem('graphiti-layout-nodeLabelZoom', String(nodeLabelZoom));
    localStorage.setItem('graphiti-layout-edgeLabelZoom', String(edgeLabelZoom));
  }, [linkDistance, chargeStrength, centerStrength, nodeSize, curveSpacing, nodeLabelZoom, edgeLabelZoom]);

  // Persist node limit to localStorage
  useEffect(() => {
    localStorage.setItem('graphiti-limit', String(limit));
  }, [limit]);

  // Auto-refresh queue status every 2 seconds
  useEffect(() => {
    const fetchQueueStatus = async () => {
      try {
        const res = await api.get('/dashboard/status').catch(() => null);
        if (res?.data?.queue) {
          const newStatus = res.data.queue as QueueStatus;
          const wasProcessing = prevProcessingRef.current > 0;
          const isNowIdle = newStatus.currently_processing === 0;

          // Auto-refresh graph when queue finishes processing (busy -> idle)
          if (wasProcessing && isNowIdle) {
            setRefreshKey(k => k + 1);
          }

          prevProcessingRef.current = newStatus.currently_processing;

          // Only update state if values actually changed to avoid re-renders
          setQueueStatus(prev => {
            if (prev?.total_pending === newStatus.total_pending &&
                prev?.currently_processing === newStatus.currently_processing) {
              return prev; // No change, return same reference
            }
            return newStatus;
          });
        }
      } catch {
        // Silently ignore polling errors
      }
    };

    fetchQueueStatus(); // Initial fetch
    const interval = setInterval(fetchQueueStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  // Graph Editor state
  const [showCreateNodeModal, setShowCreateNodeModal] = useState(false);
  const [showCreateEdgeModal, setShowCreateEdgeModal] = useState(false);
  const [showSendKnowledgeModal, setShowSendKnowledgeModal] = useState(false);
  const [knowledgeContent, setKnowledgeContent] = useState('');
  const [isEditingNode, setIsEditingNode] = useState(false);
  const [isEditingEdge, setIsEditingEdge] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [edgeSourceNode, setEdgeSourceNode] = useState<Node | null>(null);
  const [edgeTargetNode, setEdgeTargetNode] = useState<Node | null>(null);

  // Form state for modals
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeType, setNewNodeType] = useState('');
  const [newNodeSummary, setNewNodeSummary] = useState('');
  const [newEdgeType, setNewEdgeType] = useState('');
  const [newEdgeFact, setNewEdgeFact] = useState('');

  // Entity types state for dynamic forms
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [selectedEntityType, setSelectedEntityType] = useState<EntityType | null>(null);
  const [nodeAttributes, setNodeAttributes] = useState<Record<string, string>>({});

  // Edit form state
  const [editNodeName, setEditNodeName] = useState('');
  const [editNodeSummary, setEditNodeSummary] = useState('');
  const [editNodeType, setEditNodeType] = useState('');
  const [editNodeAttributes, setEditNodeAttributes] = useState<Record<string, string>>({});
  const [editEdgeName, setEditEdgeName] = useState('');
  const [editEdgeFact, setEditEdgeFact] = useState('');

  // Confirmation/Alert modal state
  const [showDeleteGraphConfirm, setShowDeleteGraphConfirm] = useState(false);
  const [showDeleteNodeConfirm, setShowDeleteNodeConfirm] = useState(false);
  const [showDeleteEdgeConfirm, setShowDeleteEdgeConfirm] = useState(false);
  const [alertMessage, setAlertMessage] = useState<{ type: 'error' | 'success' | 'info'; title: string; message: string } | null>(null);

  // Create graph modal state
  const [showCreateGraphModal, setShowCreateGraphModal] = useState(false);
  const [newGraphId, setNewGraphId] = useState('');

  // Rename graph modal state
  const [showRenameGraphModal, setShowRenameGraphModal] = useState(false);
  const [renameGraphNewName, setRenameGraphNewName] = useState('');

  // Helper to get actual entity type (labels[0] or fallback to type)
  const getEntityType = useCallback((node: Node | null | undefined): string => {
    if (!node) return '';
    return node.labels?.[0] || node.type || '';
  }, []);

  // Extract unique types from visible nodes and build color map (memoized)
  // Use labels[0] as the actual entity type, fallback to type
  const nodeTypes = useMemo(() =>
    graphData
      ? [...new Set(graphData.nodes.map(n => n.labels?.[0] || n.type))].filter(Boolean).sort()
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

  // Memoize graph data for ForceGraph to prevent unnecessary simulation restarts
  const forceGraphData = useMemo(() => {
    if (!graphData) return null;

    // Build set of valid node IDs for edge filtering
    const nodeIds = new Set(graphData.nodes.map(n => n.id));

    // Filter edges: only include those with valid source and target
    const validEdges = graphData.edges.filter(e => {
      const src = typeof e.source === 'string' ? e.source : e.source?.id;
      const tgt = typeof e.target === 'string' ? e.target : e.target?.id;
      return src && tgt && nodeIds.has(src) && nodeIds.has(tgt);
    });

    return {
      nodes: graphData.nodes as GraphNode[],
      links: validEdges.map((e, i) => ({ ...e, index: i })) as GraphEdge[],
    };
  }, [graphData]);

  // Update processedEdgesRef when graphData changes (used for sidebar connections)
  useEffect(() => {
    if (graphData) {
      processedEdgesRef.current = graphData.edges.map((e, i) => ({ ...e, originalIndex: i }));
    } else {
      processedEdgesRef.current = [];
    }
  }, [graphData]);

  const handleCreateGraph = () => {
    const trimmedId = newGraphId.trim();
    if (!trimmedId) return;

    // Just select the group - don't add to list until first node/edge is created
    setSelectedGroup(trimmedId);
    setShowCreateGraphModal(false);
    setNewGraphId('');

    if (!groups.includes(trimmedId)) {
      setAlertMessage({
        type: 'info',
        title: 'New Graph Selected',
        message: `Graph "${trimmedId}" will be created when you add nodes or edges.`,
      });
    }
  };

  // Helper to ensure selectedGroup is in groups list after creating content
  const ensureGroupInList = () => {
    if (selectedGroup && !groups.includes(selectedGroup)) {
      setGroups(prev => [...prev, selectedGroup].sort());
    }
  };

  const handleRenameGraph = async () => {
    if (!selectedGroup || !renameGraphNewName.trim()) return;

    const newName = renameGraphNewName.trim();
    if (newName === selectedGroup) {
      setShowRenameGraphModal(false);
      return;
    }

    setIsSaving(true);
    try {
      const response = await api.put(`/graph/group/${encodeURIComponent(selectedGroup)}/rename`, {
        new_name: newName,
      });

      if (response.data.success) {
        // Update groups list
        setGroups(prev => prev.map(g => g === selectedGroup ? newName : g).sort());
        // Update selected group
        setSelectedGroup(newName);
        setShowRenameGraphModal(false);
        setRenameGraphNewName('');
        setAlertMessage({
          type: 'success',
          title: 'Graph Renamed',
          message: `Graph renamed from "${selectedGroup}" to "${newName}"`,
        });
      } else {
        setAlertMessage({ type: 'error', title: 'Rename Failed', message: response.data.error });
      }
    } catch (err: any) {
      setAlertMessage({ type: 'error', title: 'Error', message: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteGraph = async () => {
    if (!selectedGroup) return;
    setShowDeleteGraphConfirm(true);
  };

  const confirmDeleteGraph = async () => {
    if (!selectedGroup) return;

    setIsDeleting(true);
    try {
      const response = await api.delete(`/graph/group/${selectedGroup}`);
      if (response.data.success) {
        setGroups(groups.filter(g => g !== selectedGroup));
        setSelectedGroup('');
        setShowDeleteGraphConfirm(false);
      } else {
        setAlertMessage({ type: 'error', title: 'Delete Failed', message: response.data.error });
      }
    } catch (err: any) {
      setAlertMessage({ type: 'error', title: 'Error', message: err.message });
    } finally {
      setIsDeleting(false);
    }
  };

  // Get color for a type
  const getTypeColor = (type: string) => typeColors[type] || defaultColor;

  // Handle node click - highlight connected nodes and edges
  const handleNodeClick = useCallback((node: Node, edges: Edge[]) => {
    // Cancel edit mode when clicking a different node
    setIsEditingNode(false);
    setEditNodeAttributes({});

    setSelectedNode(node);
    setSelectedEdge(null);

    const connectedNodes = new Set<string>([node.id]);
    const connectedEdgeIndices = new Set<number>();

    edges.forEach((edge, index) => {
      const sourceId = typeof edge.source === 'string' ? edge.source : edge.source?.id;
      const targetId = typeof edge.target === 'string' ? edge.target : edge.target?.id;
      if (!sourceId || !targetId) return; // Skip edges with missing source/target

      if (sourceId === node.id || targetId === node.id) {
        connectedNodes.add(sourceId);
        connectedNodes.add(targetId);
        connectedEdgeIndices.add(index);
      }
    });

    setHighlightedNodes(connectedNodes);
    setHighlightedEdges(connectedEdgeIndices);
  }, []);

  // Refs for episode loading to avoid re-render loops
  const loadedEpisodesRef = useRef(loadedEpisodes);
  const loadingEpisodesRef = useRef(loadingEpisodes);
  const selectedGroupRef = useRef(selectedGroup);
  loadedEpisodesRef.current = loadedEpisodes;
  loadingEpisodesRef.current = loadingEpisodes;
  selectedGroupRef.current = selectedGroup;

  // Load episode content in background (no UI toggle)
  // groupId: pass edge's group_id to ensure correct graph is queried
  const loadEpisodeBackground = useCallback(async (episodeUuid: string, groupId?: string) => {
    if (loadedEpisodesRef.current[episodeUuid] || loadingEpisodesRef.current.has(episodeUuid)) return;

    setLoadingEpisodes(prev => new Set(prev).add(episodeUuid));
    try {
      // Include group_id for FalkorDB (each group is a separate graph)
      // Use passed groupId (from edge) or fall back to selectedGroup
      const params = new URLSearchParams();
      const effectiveGroupId = groupId || selectedGroupRef.current;
      if (effectiveGroupId) params.append('group_id', effectiveGroupId);
      const response = await api.get(`/graph/episode/${episodeUuid}?${params}`);
      if (response.data.success && response.data.episode) {
        setLoadedEpisodes(prev => ({
          ...prev,
          [episodeUuid]: response.data.episode,
        }));
      }
    } catch (err) {
      console.error('Failed to load episode:', err);
    } finally {
      setLoadingEpisodes(prev => {
        const next = new Set(prev);
        next.delete(episodeUuid);
        return next;
      });
    }
  }, []);

  // Handle edge click - highlight source and target nodes
  const handleEdgeClick = useCallback((edge: Edge, edgeIndex: number) => {
    // ForceGraph modifies edge objects and loses properties like group_id
    // Look up the original edge from graphData to preserve all properties
    const originalEdge = graphData?.edges.find(e => e.uuid === edge.uuid) || edge;
    setSelectedEdge(originalEdge);
    setSelectedNode(null);
    setExpandedEpisode(null); // Reset expanded episode when selecting new edge

    const sourceId = typeof edge.source === 'string' ? edge.source : edge.source?.id;
    const targetId = typeof edge.target === 'string' ? edge.target : edge.target?.id;

    setHighlightedNodes(new Set([sourceId, targetId].filter(Boolean) as string[]));
    setHighlightedEdges(new Set([edgeIndex]));

    // Pre-load episodes for this edge (using ref to avoid dependency)
    if (originalEdge.episodes && originalEdge.episodes.length > 0) {
      originalEdge.episodes.forEach(episodeId => {
        if (!loadedEpisodesRef.current[episodeId]) {
          loadEpisodeBackground(episodeId, originalEdge.group_id);
        }
      });
    }
  }, [loadEpisodeBackground, graphData]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedNode(null);
    setSelectedEdge(null);
    setHighlightedNodes(new Set());
    setHighlightedEdges(new Set());
  }, []);

  // Navigate to a node from sidebar
  const navigateToNode = useCallback((node: Node) => {
    setSelectedNode(node);
    setSelectedEdge(null);

    const edges = processedEdgesRef.current;
    const connectedNodes = new Set<string>([node.id]);
    const connectedEdgeIndices = new Set<number>();

    edges.forEach((edge) => {
      const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as Node).id;
      const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as Node).id;

      if (sourceId === node.id || targetId === node.id) {
        connectedNodes.add(sourceId);
        connectedNodes.add(targetId);
        if (edge.originalIndex !== undefined) {
          connectedEdgeIndices.add(edge.originalIndex);
        }
      }
    });

    setHighlightedNodes(connectedNodes);
    setHighlightedEdges(connectedEdgeIndices);
  }, []);

  // Navigate to an edge from sidebar
  const navigateToEdge = useCallback((edge: Edge) => {
    // Ensure we have the original edge with all properties (including group_id)
    const originalEdge = graphData?.edges.find(e => e.uuid === edge.uuid) || edge;
    setSelectedEdge(originalEdge);
    setSelectedNode(null);
    setExpandedEpisode(null); // Reset expanded episode when navigating to new edge

    const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as Node).id;
    const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as Node).id;

    setHighlightedNodes(new Set([sourceId, targetId]));
    if (edge.originalIndex !== undefined) {
      setHighlightedEdges(new Set([edge.originalIndex]));
    }

    // Pre-load episodes for this edge
    if (originalEdge.episodes && originalEdge.episodes.length > 0) {
      originalEdge.episodes.forEach(episodeId => {
        if (!loadedEpisodes[episodeId]) {
          loadEpisodeBackground(episodeId, originalEdge.group_id);
        }
      });
    }
  }, [loadedEpisodes, loadEpisodeBackground, graphData]);

  // Get a node by ID from graphData
  const getNodeById = useCallback((id: string): Node | undefined => {
    return graphData?.nodes.find(n => n.id === id);
  }, [graphData]);

  // Resolve edge source/target to Node object (handles both string IDs and Node objects)
  const resolveEdgeSource = useCallback((edge: Edge): Node | undefined => {
    if (typeof edge.source === 'string') {
      return getNodeById(edge.source);
    }
    return edge.source as Node;
  }, [getNodeById]);

  const resolveEdgeTarget = useCallback((edge: Edge): Node | undefined => {
    if (typeof edge.target === 'string') {
      return getNodeById(edge.target);
    }
    return edge.target as Node;
  }, [getNodeById]);

  // Get connected edges for a node
  const getConnectedEdges = useCallback((node: Node): Edge[] => {
    return processedEdgesRef.current.filter(edge => {
      const sourceId = typeof edge.source === 'string' ? edge.source : (edge.source as Node).id;
      const targetId = typeof edge.target === 'string' ? edge.target : (edge.target as Node).id;
      return sourceId === node.id || targetId === node.id;
    });
  }, []);

  // Get attributes ordered by entity type field order
  const getOrderedAttributes = useCallback((node: Node): [string, any][] => {
    if (!node.attributes || Object.keys(node.attributes).length === 0) {
      return [];
    }

    // Find entity type for this node
    const nodeEntityType = node.labels?.[0] || node.type;
    const entityType = entityTypes.find(et => et.name === nodeEntityType);

    // Get field order from entity type
    const fieldOrder = entityType?.fields?.map(f => f.name) || [];

    // Sort attributes: entity type fields first (in order), then remaining alphabetically
    const entries = Object.entries(node.attributes);
    return entries.sort(([a], [b]) => {
      const aIndex = fieldOrder.indexOf(a);
      const bIndex = fieldOrder.indexOf(b);
      // Both in field order: sort by order
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      // Only a in field order: a first
      if (aIndex !== -1) return -1;
      // Only b in field order: b first
      if (bIndex !== -1) return 1;
      // Neither: alphabetical
      return a.localeCompare(b);
    });
  }, [entityTypes]);

  // Load episode content on demand (with UI toggle)
  // groupId: pass edge's group_id to ensure correct graph is queried (important for "All Graphs" view)
  const loadEpisode = useCallback(async (episodeUuid: string, groupId?: string) => {
    // Already loaded - just toggle
    if (loadedEpisodes[episodeUuid]) {
      setExpandedEpisode(expandedEpisode === episodeUuid ? null : episodeUuid);
      return;
    }

    // Currently loading - toggle when done
    if (loadingEpisodes.has(episodeUuid)) {
      return;
    }

    setLoadingEpisodes(prev => new Set(prev).add(episodeUuid));
    try {
      // Include group_id for FalkorDB (each group is a separate graph)
      // Use passed groupId (from edge) or fall back to selectedGroup
      const params = new URLSearchParams();
      const effectiveGroupId = groupId || selectedGroup;
      if (effectiveGroupId) params.append('group_id', effectiveGroupId);
      const response = await api.get(`/graph/episode/${episodeUuid}?${params}`);
      if (response.data.success && response.data.episode) {
        setLoadedEpisodes(prev => ({
          ...prev,
          [episodeUuid]: response.data.episode,
        }));
        setExpandedEpisode(episodeUuid);
      }
    } catch (err) {
      console.error('Failed to load episode:', err);
    } finally {
      setLoadingEpisodes(prev => {
        const next = new Set(prev);
        next.delete(episodeUuid);
        return next;
      });
    }
  }, [loadedEpisodes, loadingEpisodes, expandedEpisode, selectedGroup]);

  // ============================================
  // Graph Editor Handlers
  // ============================================

  const openCreateNodeModal = async () => {
    // Reset form state
    setNewNodeName('');
    setNewNodeType('');
    setNewNodeSummary('');
    setSelectedEntityType(null);
    setNodeAttributes({});

    // Load entity types from backend
    try {
      const response = await api.get('/entity-types');
      setEntityTypes(response.data || []);
    } catch (err) {
      console.error('Failed to load entity types:', err);
      setEntityTypes([]);
    }

    setShowCreateNodeModal(true);
  };

  const handleEntityTypeChange = (typeName: string) => {
    if (typeName === '__custom__') {
      setSelectedEntityType(null);
      setNewNodeType('');
      setNodeAttributes({});
    } else {
      const entityType = entityTypes.find(et => et.name === typeName);
      setSelectedEntityType(entityType || null);
      setNewNodeType(typeName);
      // Initialize attributes for required fields
      const attrs: Record<string, string> = {};
      if (entityType?.fields) {
        entityType.fields.forEach(f => {
          attrs[f.name] = '';
        });
      }
      setNodeAttributes(attrs);
    }
  };

  const handleCreateNode = async () => {
    if (!newNodeName.trim() || !selectedGroup) {
      setAlertMessage({ type: 'error', title: 'Missing Data', message: 'Please enter a node name and select a group' });
      return;
    }

    setIsSaving(true);
    try {
      // Filter out empty attributes
      const filteredAttrs: Record<string, string> = {};
      Object.entries(nodeAttributes).forEach(([key, value]) => {
        if (value && value.trim()) {
          filteredAttrs[key] = value.trim();
        }
      });

      const entityType = newNodeType.trim() || 'Entity';
      const response = await api.post('/graph/node/direct', {
        name: newNodeName.trim(),
        entity_type: entityType,
        summary: newNodeSummary.trim(),
        group_id: selectedGroup,
        attributes: Object.keys(filteredAttrs).length > 0 ? filteredAttrs : undefined,
      });

      if (response.data.success) {
        // Add node locally instead of full refresh
        const newNode: Node = {
          id: response.data.uuid,
          name: newNodeName.trim(),
          type: entityType,
          labels: entityType !== 'Entity' ? [entityType] : [],
          summary: newNodeSummary.trim(),
          group_id: selectedGroup,
          created_at: new Date().toISOString(),
          attributes: Object.keys(filteredAttrs).length > 0 ? filteredAttrs : {},
        };
        setGraphData(prev => prev ? {
          ...prev,
          nodes: [...prev.nodes, newNode],
        } : prev);

        setShowCreateNodeModal(false);
        setNewNodeName('');
        setNewNodeType('');
        setNewNodeSummary('');
        setSelectedEntityType(null);
        setNodeAttributes({});
        ensureGroupInList();
      } else {
        setAlertMessage({ type: 'error', title: 'Create Failed', message: response.data.error });
      }
    } catch (err: any) {
      setAlertMessage({ type: 'error', title: 'Error', message: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateEdge = async () => {
    const missing: string[] = [];
    if (!edgeSourceNode) missing.push('source node');
    if (!edgeTargetNode) missing.push('target node');
    if (!newEdgeType.trim()) missing.push('relationship type');
    if (!selectedGroup) missing.push('group');
    if (missing.length > 0) {
      setAlertMessage({ type: 'error', title: 'Missing Data', message: `Please provide: ${missing.join(', ')}` });
      return;
    }

    const relationshipType = newEdgeType.trim().toUpperCase().replace(/\s+/g, '_');
    setIsSaving(true);
    try {
      const response = await api.post('/graph/edge/direct', {
        source_uuid: edgeSourceNode!.id,
        target_uuid: edgeTargetNode!.id,
        relationship_type: relationshipType,
        fact: newEdgeFact.trim(),
        group_id: selectedGroup,
      });

      if (response.data.success) {
        // Add edge locally instead of full refresh
        const newEdge: Edge = {
          uuid: response.data.uuid,
          source: edgeSourceNode!.id,
          target: edgeTargetNode!.id,
          type: relationshipType,
          fact: newEdgeFact.trim() || `${relationshipType} relationship`,
          created_at: new Date().toISOString(),
        };
        setGraphData(prev => prev ? {
          ...prev,
          edges: [...prev.edges, newEdge],
        } : prev);

        setShowCreateEdgeModal(false);
        setEdgeSourceNode(null);
        setEdgeTargetNode(null);
        setNewEdgeType('');
        setNewEdgeFact('');
        ensureGroupInList();
      } else {
        setAlertMessage({ type: 'error', title: 'Create Failed', message: response.data.error });
      }
    } catch (err: any) {
      setAlertMessage({ type: 'error', title: 'Error', message: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendKnowledge = async () => {
    if (!knowledgeContent.trim() || !selectedGroup) {
      setAlertMessage({ type: 'error', title: 'Missing Data', message: 'Please enter knowledge text and select a group' });
      return;
    }

    setIsSaving(true);
    try {
      const response = await api.post('/graph/knowledge', {
        content: knowledgeContent.trim(),
        group_id: selectedGroup,
      });

      if (response.data.success) {
        setShowSendKnowledgeModal(false);
        setKnowledgeContent('');
        ensureGroupInList(); // Add new graph to dropdown
        setAlertMessage({
          type: 'info',
          title: 'Knowledge Submitted',
          message: 'The LLM is processing your input. Graph will refresh automatically when done.',
        });
        // Start spinner immediately, auto-refresh happens when queue finishes
        setQueueStatus({ total_pending: 1, currently_processing: 1 });
        prevProcessingRef.current = 1;
      } else {
        setAlertMessage({ type: 'error', title: 'Submit Failed', message: response.data.error });
      }
    } catch (err: any) {
      setAlertMessage({ type: 'error', title: 'Error', message: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const startEditingNode = async () => {
    if (!selectedNode) return;
    setEditNodeName(selectedNode.name || '');
    setEditNodeSummary(selectedNode.summary || '');
    setEditNodeType(selectedNode.labels?.[0] || selectedNode.type || 'Entity');

    // Fetch entity types from DB if not loaded yet
    let currentEntityTypes = entityTypes;
    if (currentEntityTypes.length === 0) {
      try {
        const etResponse = await api.get('/entity-types');
        // API returns list directly, not {entity_types: [...]}
        currentEntityTypes = Array.isArray(etResponse.data) ? etResponse.data : [];
        setEntityTypes(currentEntityTypes);
      } catch (err) {
        console.error('Failed to load entity types:', err);
      }
    }

    // Find entity type for field order and set selected type for dropdown
    const nodeEntityType = selectedNode.labels?.[0] || selectedNode.type;
    const entityType = currentEntityTypes.find(et => et.name === nodeEntityType);
    setSelectedEntityType(entityType || null);
    const fieldOrder = entityType?.fields?.map(f => f.name) || [];

    // Build attrs in entity type field order (JS objects preserve insertion order)
    const attrs: Record<string, string> = {};
    const existingAttrs = selectedNode.attributes || {};

    // First: add fields in entity type order
    fieldOrder.forEach(fieldName => {
      const value = existingAttrs[fieldName];
      attrs[fieldName] = value != null ? String(value) : '';
    });

    // Second: add remaining existing attributes (not in entity type) alphabetically
    Object.keys(existingAttrs)
      .filter(key => !fieldOrder.includes(key))
      .sort()
      .forEach(key => {
        attrs[key] = existingAttrs[key] != null ? String(existingAttrs[key]) : '';
      });

    setEditNodeAttributes(attrs);
    setIsEditingNode(true);
  };

  const cancelEditingNode = () => {
    setIsEditingNode(false);
    setEditNodeName('');
    setEditNodeSummary('');
    setEditNodeType('');
    setEditNodeAttributes({});
  };

  const handleUpdateNode = async () => {
    if (!selectedNode) return;

    setIsSaving(true);
    try {
      // Build attributes: non-empty values as strings, empty values as null (for deletion)
      const processedAttributes: Record<string, string | null> = {};
      Object.entries(editNodeAttributes).forEach(([key, value]) => {
        const trimmed = value.trim();
        processedAttributes[key] = trimmed || null;  // null = delete from DB
      });

      const normalizedName = editNodeName.trim() || null;
      const normalizedSummary = editNodeSummary.trim() || null;
      const normalizedType = editNodeType.trim() || null;

      // Check if entity type changed
      const currentType = selectedNode.labels?.[0] || selectedNode.type;
      const typeChanged = normalizedType && normalizedType !== currentType;

      // Use node's actual group_id (required for FalkorDB - each group is a separate graph)
      const nodeGroupId = selectedNode.group_id || selectedGroup;
      const url = nodeGroupId
        ? `/graph/node/${selectedNode.id}?group_id=${encodeURIComponent(nodeGroupId)}`
        : `/graph/node/${selectedNode.id}`;
      const response = await api.put(url, {
        name: normalizedName,
        summary: normalizedSummary,
        entity_type: typeChanged ? normalizedType : undefined,
        attributes: Object.keys(processedAttributes).length > 0 ? processedAttributes : undefined,
      });

      if (response.data.success) {
        setIsEditingNode(false);
        setEditNodeAttributes({});
        setEditNodeType('');

        const updatedName = normalizedName || selectedNode.name;
        const updatedSummary = normalizedSummary || selectedNode.summary;
        const updatedType = typeChanged ? normalizedType : currentType;
        const updatedLabels = typeChanged ? [normalizedType!] : selectedNode.labels;

        // Filter out null values for display (they were deleted from DB)
        const displayAttributes: Record<string, string> = {};
        Object.entries(processedAttributes).forEach(([key, value]) => {
          if (value !== null) {
            displayAttributes[key] = value;
          }
        });

        // Update selected node with new values so sidebar shows updated data
        setSelectedNode({
          ...selectedNode,
          name: updatedName,
          summary: updatedSummary,
          type: updatedType,
          labels: updatedLabels,
          attributes: displayAttributes,
        });

        // Update node in graphData without full reload
        if (graphData) {
          setGraphData({
            ...graphData,
            nodes: graphData.nodes.map(n =>
              n.id === selectedNode.id
                ? { ...n, name: updatedName, summary: updatedSummary, type: updatedType, labels: updatedLabels, attributes: displayAttributes }
                : n
            ),
          });
        }
      } else {
        setAlertMessage({ type: 'error', title: 'Update Failed', message: response.data.error });
      }
    } catch (err: any) {
      setAlertMessage({ type: 'error', title: 'Error', message: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteNode = async () => {
    if (!selectedNode) return;
    setShowDeleteNodeConfirm(true);
  };

  const confirmDeleteNode = async () => {
    if (!selectedNode) return;

    setIsSaving(true);
    try {
      // Use node's actual group_id (required for FalkorDB - each group is a separate graph)
      const nodeGroupId = selectedNode.group_id || selectedGroup;
      const url = nodeGroupId
        ? `/graph/node/${selectedNode.id}?group_id=${encodeURIComponent(nodeGroupId)}`
        : `/graph/node/${selectedNode.id}`;
      const response = await api.delete(url);

      if (response.data.success) {
        const deletedNodeId = selectedNode.id;
        setShowDeleteNodeConfirm(false);
        clearSelection();
        // Remove node and connected edges locally instead of full refresh
        setGraphData(prev => prev ? {
          ...prev,
          nodes: prev.nodes.filter(n => n.id !== deletedNodeId),
          edges: prev.edges.filter(e => {
            const sourceId = typeof e.source === 'string' ? e.source : e.source?.id;
            const targetId = typeof e.target === 'string' ? e.target : e.target?.id;
            return sourceId !== deletedNodeId && targetId !== deletedNodeId;
          }),
        } : prev);
      } else {
        setAlertMessage({ type: 'error', title: 'Delete Failed', message: response.data.error });
      }
    } catch (err: any) {
      setAlertMessage({ type: 'error', title: 'Error', message: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const startEditingEdge = () => {
    if (!selectedEdge) return;
    setEditEdgeName(selectedEdge.type || '');
    setEditEdgeFact(selectedEdge.fact || '');
    setIsEditingEdge(true);
  };

  const cancelEditingEdge = () => {
    setIsEditingEdge(false);
    setEditEdgeName('');
    setEditEdgeFact('');
  };

  const handleUpdateEdge = async () => {
    if (!selectedEdge || !selectedEdge.uuid) return;

    setIsSaving(true);
    try {
      // Convert edge name to UPPER_SNAKE_CASE (same as when creating edges)
      const normalizedName = editEdgeName.trim()
        ? editEdgeName.trim().toUpperCase().replace(/\s+/g, '_')
        : null;
      const normalizedFact = editEdgeFact.trim() || null;

      // Derive group_id from source node (edges exist within the same graph as their nodes)
      const sourceNodeId = typeof selectedEdge.source === 'string' ? selectedEdge.source : selectedEdge.source?.id;
      const sourceNode = graphData?.nodes.find(n => n.id === sourceNodeId);
      const edgeGroupId = sourceNode?.group_id || selectedGroup;
      const url = edgeGroupId
        ? `/graph/edge/${selectedEdge.uuid}?group_id=${encodeURIComponent(edgeGroupId)}`
        : `/graph/edge/${selectedEdge.uuid}`;
      const response = await api.put(url, {
        name: normalizedName,
        fact: normalizedFact,
      });

      if (response.data.success) {
        setIsEditingEdge(false);

        const updatedType = normalizedName || selectedEdge.type;
        const updatedFact = normalizedFact || selectedEdge.fact;

        // Update selected edge with new values so sidebar shows updated data
        setSelectedEdge({
          ...selectedEdge,
          type: updatedType,
          fact: updatedFact,
        });

        // Also update the edit fields to show normalized values
        if (normalizedName) setEditEdgeName(normalizedName);

        // Update edge in graphData without full reload
        if (graphData) {
          setGraphData({
            ...graphData,
            edges: graphData.edges.map(e =>
              e.uuid === selectedEdge.uuid
                ? { ...e, type: updatedType, fact: updatedFact }
                : e
            ),
          });
        }
      } else {
        setAlertMessage({ type: 'error', title: 'Update Failed', message: response.data.error });
      }
    } catch (err: any) {
      setAlertMessage({ type: 'error', title: 'Error', message: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEdge = async () => {
    if (!selectedEdge || !selectedEdge.uuid) return;
    setShowDeleteEdgeConfirm(true);
  };

  const confirmDeleteEdge = async () => {
    if (!selectedEdge || !selectedEdge.uuid) return;

    setIsSaving(true);
    try {
      // Derive group_id from source node (edges exist within the same graph as their nodes)
      const sourceNodeId = typeof selectedEdge.source === 'string' ? selectedEdge.source : selectedEdge.source?.id;
      const sourceNode = graphData?.nodes.find(n => n.id === sourceNodeId);
      const edgeGroupId = sourceNode?.group_id || selectedGroup;
      const url = edgeGroupId
        ? `/graph/edge/${selectedEdge.uuid}?group_id=${encodeURIComponent(edgeGroupId)}`
        : `/graph/edge/${selectedEdge.uuid}`;
      const response = await api.delete(url);

      if (response.data.success) {
        const deletedEdgeUuid = selectedEdge.uuid;
        setShowDeleteEdgeConfirm(false);
        clearSelection();
        // Remove edge locally instead of full refresh
        setGraphData(prev => prev ? {
          ...prev,
          edges: prev.edges.filter(e => e.uuid !== deletedEdgeUuid),
        } : prev);
      } else {
        setAlertMessage({ type: 'error', title: 'Delete Failed', message: response.data.error });
      }
    } catch (err: any) {
      setAlertMessage({ type: 'error', title: 'Error', message: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  // Open edge creation modal with source node
  const openEdgeCreationFromNode = (sourceNode: Node) => {
    setEdgeSourceNode(sourceNode);
    setEdgeTargetNode(null);
    setShowCreateEdgeModal(true);
  };

  // Panel resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = panelWidth;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = startX - e.clientX;
      const newWidth = Math.max(300, Math.min(800, startWidth + delta));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelWidth]);

  // Fetch available groups on mount
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const response = await api.get('/graph/groups');
        if (response.data.success && response.data.group_ids?.length > 0) {
          setGroups(response.data.group_ids);
          // Keep "All Graphs" (empty string) as default - don't auto-select
        }
      } catch (err) {
        console.error('Failed to fetch groups:', err);
      }
    };
    fetchGroups();
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      // Fetch data immediately - empty selectedGroup means "All Graphs"

      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: limit.toString() });
        if (selectedGroup) params.append('group_id', selectedGroup);

        const response = await api.get(`/graph/data?${params}`);
        setGraphData(response.data);

        // Load entity types for edit mode (if not already loaded)
        if (entityTypes.length === 0) {
          try {
            const etResponse = await api.get('/entity-types');
            // API returns list directly, not {entity_types: [...]}
            setEntityTypes(Array.isArray(etResponse.data) ? etResponse.data : []);
          } catch (err) {
            console.error('Failed to load entity types:', err);
          }
        }
      } catch (err: any) {
        setError(err.response?.data?.detail || 'Failed to load graph data');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [limit, selectedGroup, refreshKey, groups.length]);


  return (
    <div className="d-flex flex-column" style={{ height: 'calc(100vh - 2rem)' }}>
      {/* Controls */}
      <div className="card mb-3">
        <div className="card-body py-2">
          <div className="row align-items-center">
            <div className="col-auto">
              <div className="input-group input-group-sm">
                <select
                  value={selectedGroup}
                  onChange={e => setSelectedGroup(e.target.value)}
                  className="form-select form-select-sm"
                  style={{ minWidth: '150px' }}
                >
                  <option value="">All Groups</option>
                  {/* Show pending new graph if selected but not yet in list */}
                  {selectedGroup && !groups.includes(selectedGroup) && (
                    <option value={selectedGroup}>{selectedGroup} (new)</option>
                  )}
                  {groups.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                {selectedGroup && (
                  <button
                    className="btn btn-sm btn-input-group"
                    onClick={(e) => {
                      (e.target as HTMLButtonElement).blur();
                      setRenameGraphNewName(selectedGroup);
                      setShowRenameGraphModal(true);
                    }}
                    title="Rename graph"
                  >
                    <IconEdit size={16} />
                  </button>
                )}
                <button
                  className="btn btn-sm btn-input-group"
                  onClick={(e) => {
                    (e.target as HTMLButtonElement).blur();
                    setShowCreateGraphModal(true);
                  }}
                  title="Create new graph"
                >
                  <IconPlus size={16} />
                </button>
              </div>
            </div>
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
                <option value={1500}>1500 Nodes</option>
                <option value={2000}>2000 Nodes</option>
                <option value={3000}>3000 Nodes</option>
                <option value={5000}>5000 Nodes</option>
                <option value={10000}>10000 Nodes</option>
              </select>
            </div>
            <div className="col-auto d-flex align-items-center gap-2">
              {graphData && (
                <span className="text-secondary">
                  <span className={graphData.nodes.length >= limit ? 'text-danger fw-bold' : ''}>
                    {graphData.nodes.length} Nodes
                  </span>
                  {' • '}
                  <span className={graphData.edges.length >= limit * 2 ? 'text-danger fw-bold' : ''}>
                    {graphData.edges.length} Edges
                  </span>
                  {graphData.stats?.episode_count != null && graphData.stats.episode_count > 0 && (
                    <>
                      {' • '}
                      <span title={`${graphData.stats.episode_edge_count || 0} episode references`}>
                        {graphData.stats.episode_count} Episodes
                      </span>
                    </>
                  )}
                </span>
              )}
              {(queueStatus?.currently_processing ?? 0) > 0 && (
                <IconLoader2 size={16} className="text-warning spin" title="Processing queue active" />
              )}
            </div>

            {/* Spacer */}
            <div className="col"></div>

            {/* Action buttons group */}
            {selectedGroup && (
              <div className="col-auto d-flex align-items-center gap-2">
                <button
                  onClick={openCreateNodeModal}
                  className="btn btn-sm btn-primary"
                  title="Create new entity (direct, no LLM)"
                >
                  <IconPlus size={16} className="me-1" />
                  Node
                </button>
                <button
                  onClick={() => setShowCreateEdgeModal(true)}
                  className="btn btn-sm btn-primary"
                  title="Create relationship (direct, no LLM)"
                >
                  <IconLink size={16} className="me-1" />
                  Edge
                </button>
                <span className="text-muted small" title="Hold Shift and drag from one node to another">
                  <kbd>Shift</kbd>+Drag
                </span>
                <span className="border-start mx-2" style={{ height: '20px' }}></span>
                <button
                  onClick={() => setShowSendKnowledgeModal(true)}
                  className="btn btn-sm btn-outline-primary"
                  title="Send knowledge text to LLM for extraction"
                >
                  <IconBrain size={16} className="me-1" />
                  Send Knowledge
                </button>
              </div>
            )}

            {/* Spacer */}
            <div className="col"></div>

            {/* Delete button */}
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
          </div>
        </div>
      </div>

      {/* Graph container */}
      <div ref={containerRef} className="card flex-grow-1 position-relative">
        {isLoading && (
          <div className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ backgroundColor: 'var(--tblr-card-bg)', opacity: 0.95, zIndex: 1000 }}>
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

        {/* Force Graph Visualization */}
        {forceGraphData && (
          <ForceGraphVisualization
            graphData={forceGraphData}
            onNodeClick={(node) => handleNodeClick(node as Node, graphData!.edges)}
            onEdgeClick={(edge) => handleEdgeClick(edge as Edge, edge.index || 0)}
            onBackgroundClick={clearSelection}
            hasSelectedNode={selectedNode !== null && !!selectedGroup}
            onShiftClickNode={(target) => {
              // Shift+Click only works when a group is selected and a node is selected
              if (selectedNode && selectedGroup && target.id !== selectedNode.id) {
                const targetNode = graphData?.nodes.find(n => n.id === target.id);
                if (targetNode) {
                  setEdgeSourceNode(selectedNode);
                  setEdgeTargetNode(targetNode);
                  setShowCreateEdgeModal(true);
                }
              } else {
                // No node/group selected - treat as normal click to select
                handleNodeClick(target as Node, graphData!.edges);
              }
            }}
            highlightedNodes={highlightedNodes}
            highlightedEdges={highlightedEdges}
            linkDistance={linkDistance}
            chargeStrength={chargeStrength}
            centerStrength={centerStrength}
            nodeSize={nodeSize}
            curveSpacing={curveSpacing}
            nodeLabelZoom={nodeLabelZoom}
            edgeLabelZoom={edgeLabelZoom}
          />
        )}

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

        {/* Layout Controls */}
        <div className="card position-absolute" style={{ bottom: '1rem', left: '1rem', width: showLayoutControls ? '280px' : 'auto' }}>
          <div className="card-body py-2 px-3">
            <div
              className="d-flex align-items-center gap-2 cursor-pointer"
              onClick={() => setShowLayoutControls(!showLayoutControls)}
              style={{ cursor: 'pointer' }}
            >
              <IconAdjustments size={18} />
              <span className="fw-medium">Layout</span>
              <span className="ms-auto text-muted small">{showLayoutControls ? '▼' : '▶'}</span>
            </div>
            {showLayoutControls && (
              <div className="mt-3">
                <div className="mb-3">
                  <label className="form-label small d-flex justify-content-between">
                    <span>Node Distance</span>
                    <span className="text-muted">{linkDistance / 10}</span>
                  </label>
                  <input
                    type="range"
                    className="form-range"
                    min="5"
                    max="50"
                    step="1"
                    value={linkDistance / 10}
                    onChange={e => setLinkDistance(Number(e.target.value) * 10)}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label small d-flex justify-content-between">
                    <span>Repulsion</span>
                    <span className="text-muted">{Math.abs(chargeStrength) / 100}</span>
                  </label>
                  <input
                    type="range"
                    className="form-range"
                    min="1"
                    max="20"
                    step="1"
                    value={Math.abs(chargeStrength) / 100}
                    onChange={e => setChargeStrength(-Number(e.target.value) * 100)}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label small d-flex justify-content-between">
                    <span>Gravity</span>
                    <span className="text-muted">{centerStrength / 10}</span>
                  </label>
                  <input
                    type="range"
                    className="form-range"
                    min="0"
                    max="20"
                    step="1"
                    value={centerStrength / 10}
                    onChange={e => setCenterStrength(Number(e.target.value) * 10)}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label small d-flex justify-content-between">
                    <span>Node Size</span>
                    <span className="text-muted">{nodeSize}</span>
                  </label>
                  <input
                    type="range"
                    className="form-range"
                    min="4"
                    max="50"
                    step="2"
                    value={nodeSize}
                    onChange={e => setNodeSize(Number(e.target.value))}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label small d-flex justify-content-between">
                    <span>Edge Curve</span>
                    <span className="text-muted">{curveSpacing}</span>
                  </label>
                  <input
                    type="range"
                    className="form-range"
                    min="20"
                    max="100"
                    step="5"
                    value={curveSpacing}
                    onChange={e => setCurveSpacing(Number(e.target.value))}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label small d-flex justify-content-between">
                    <span>Node Labels (zoom)</span>
                    <span className="text-muted">{nodeLabelZoom.toFixed(1)}</span>
                  </label>
                  <input
                    type="range"
                    className="form-range"
                    min="0.5"
                    max="5"
                    step="0.5"
                    value={nodeLabelZoom}
                    onChange={e => setNodeLabelZoom(Number(e.target.value))}
                  />
                </div>
                <div className="mb-2">
                  <label className="form-label small d-flex justify-content-between">
                    <span>Edge Labels (zoom)</span>
                    <span className="text-muted">{edgeLabelZoom.toFixed(1)}</span>
                  </label>
                  <input
                    type="range"
                    className="form-range"
                    min="0.5"
                    max="5"
                    step="0.5"
                    value={edgeLabelZoom}
                    onChange={e => setEdgeLabelZoom(Number(e.target.value))}
                  />
                </div>
                <button
                  className="btn btn-sm btn-outline-secondary w-100 mt-2"
                  onClick={() => {
                    setLinkDistance(LAYOUT_DEFAULTS.linkDistance);
                    setChargeStrength(LAYOUT_DEFAULTS.chargeStrength);
                    setCenterStrength(LAYOUT_DEFAULTS.centerStrength);
                    setNodeSize(LAYOUT_DEFAULTS.nodeSize);
                    setCurveSpacing(LAYOUT_DEFAULTS.curveSpacing);
                    setNodeLabelZoom(LAYOUT_DEFAULTS.nodeLabelZoom);
                    setEdgeLabelZoom(LAYOUT_DEFAULTS.edgeLabelZoom);
                  }}
                >
                  Reset to Defaults
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Node details */}
        {selectedNode && (
          <div className="card position-absolute" style={{ top: '1rem', right: '1rem', width: `${panelWidth}px`, maxHeight: 'calc(100% - 2rem)', display: 'flex', flexDirection: 'column' }}>
            {/* Resize handle */}
            <div
              onMouseDown={handleResizeStart}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '6px',
                cursor: 'ew-resize',
                background: 'transparent',
              }}
              title="Drag to resize"
            />
            <div className="card-header d-flex align-items-center gap-2">
              <h4 className="card-title mb-0">Node Details</h4>
              {!isEditingNode && (
                <>
                  <button
                    className="btn btn-sm btn-icon ms-auto"
                    onClick={() => startEditingNode()}
                    title="Edit node"
                  >
                    <IconEdit size={16} />
                  </button>
                  <button
                    className="btn btn-sm btn-icon text-danger"
                    onClick={() => handleDeleteNode()}
                    disabled={isSaving}
                    title="Delete node"
                  >
                    <IconTrashX size={16} />
                  </button>
                </>
              )}
              <button
                className={`btn btn-close ${isEditingNode ? 'ms-auto' : ''}`}
                onClick={() => {
                  if (isEditingNode) cancelEditingNode();
                  else clearSelection();
                }}
              />
            </div>
            <div className="card-body" style={{ overflowY: 'auto', flex: 1 }}>
              {isEditingNode ? (
                /* Edit Mode */
                <>
                  <div className="mb-3">
                    <label className="form-label">Name</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editNodeName}
                      onChange={e => setEditNodeName(e.target.value)}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Type</label>
                    <select
                      className="form-select"
                      value={editNodeType}
                      onChange={e => {
                        const newType = e.target.value;
                        setEditNodeType(newType);
                        // Update attributes based on new entity type's fields
                        const entityType = entityTypes.find(et => et.name === newType);
                        if (entityType?.fields) {
                          const newAttrs: Record<string, string> = {};
                          // Add fields from new entity type (preserve existing values if field name matches)
                          entityType.fields.forEach(f => {
                            newAttrs[f.name] = editNodeAttributes[f.name] || '';
                          });
                          // Keep existing attributes not in new type (at the end)
                          Object.entries(editNodeAttributes).forEach(([key, value]) => {
                            if (!(key in newAttrs)) {
                              newAttrs[key] = value;
                            }
                          });
                          setEditNodeAttributes(newAttrs);
                        }
                      }}
                    >
                      {/* Always include Entity as first option */}
                      <option value="Entity">Entity</option>
                      {entityTypes
                        .filter(et => et.name !== 'Entity')
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map(et => (
                          <option key={et.name} value={et.name}>{et.name}</option>
                        ))
                      }
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Summary</label>
                    <textarea
                      className="form-control"
                      rows={3}
                      value={editNodeSummary}
                      onChange={e => setEditNodeSummary(e.target.value)}
                    />
                  </div>

                  {/* Editable Attributes */}
                  {Object.keys(editNodeAttributes).length > 0 && (
                    <div className="mb-3">
                      <label className="form-label">Attributes</label>
                      <div className="border rounded p-2" style={{ background: 'var(--tblr-bg-surface-secondary)' }}>
                        {Object.entries(editNodeAttributes).map(([key, value]) => (
                          <div key={key} className="mb-2">
                            <label className="form-label small mb-1">{key}</label>
                            <input
                              type="text"
                              className="form-control form-control-sm"
                              value={value}
                              onChange={e => setEditNodeAttributes(prev => ({ ...prev, [key]: e.target.value }))}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Add new attribute */}
                  <div className="mb-3">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => {
                        const name = prompt('Attribute name:');
                        if (name && name.trim()) {
                          setEditNodeAttributes(prev => ({ ...prev, [name.trim()]: '' }));
                        }
                      }}
                    >
                      + Add Attribute
                    </button>
                  </div>

                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-primary"
                      onClick={handleUpdateNode}
                      disabled={isSaving}
                    >
                      <IconCheck size={16} className="me-1" />
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={cancelEditingNode}
                      disabled={isSaving}
                    >
                      <IconX size={16} className="me-1" />
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                /* View Mode */
                <>
                  <h3 className="mb-2" style={{ wordBreak: 'break-word' }}>{selectedNode.name || 'Unknown'}</h3>
                  <div className="mb-3 d-flex flex-wrap gap-1">
                    <span
                      className="badge"
                      style={{ backgroundColor: getTypeColor(getEntityType(selectedNode)), color: 'white' }}
                    >
                      {getEntityType(selectedNode)}
                    </span>
                    {selectedNode.labels?.filter(l => l !== 'Entity' && l !== getEntityType(selectedNode)).map(label => (
                      <span key={label} className="badge bg-secondary text-white">{label}</span>
                    ))}
                  </div>

                  {selectedNode.summary && (
                    <div className="mb-3">
                      <label className="form-label text-muted small mb-1">Summary</label>
                      <p className="mb-0 small">{selectedNode.summary}</p>
                    </div>
                  )}

              {(selectedNode.id || selectedNode.group_id || selectedNode.created_at) && (
                <div className="mb-3">
                  <label className="form-label text-muted small mb-1">Metadata</label>
                  <table className="table table-sm table-borderless mb-0">
                    <tbody>
                      {selectedNode.id && (
                        <tr>
                          <td className="text-muted ps-0" style={{ width: '80px' }}>UUID</td>
                          <td className="small text-truncate" style={{ maxWidth: '200px' }} title={selectedNode.id}>
                            <code>{selectedNode.id}</code>
                          </td>
                        </tr>
                      )}
                      {selectedNode.group_id && (
                        <tr>
                          <td className="text-muted ps-0">Graph</td>
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
                <div className="mb-3">
                  <label className="form-label text-muted small mb-1">Attributes</label>
                  <table className="table table-sm table-borderless mb-0">
                    <tbody>
                      {getOrderedAttributes(selectedNode).map(([key, value]) => {
                        const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
                        const isUrl = typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'));
                        return (
                          <tr key={key}>
                            <td className="text-muted ps-0" style={{ width: '100px' }}>{key}</td>
                            <td className="small" style={{ wordBreak: 'break-word' }}>
                              {isUrl ? (
                                <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary">
                                  {strValue}
                                </a>
                              ) : strValue}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Connected Relationships */}
              {getConnectedEdges(selectedNode).length > 0 && (
                <div className="mb-3">
                  <label className="form-label text-muted small mb-1">
                    Relationships ({getConnectedEdges(selectedNode).length})
                  </label>
                  <div className="d-flex flex-column gap-1">
                    {getConnectedEdges(selectedNode).map((edge, idx) => {
                      const source = resolveEdgeSource(edge);
                      const target = resolveEdgeTarget(edge);
                      if (!source || !target) return null;
                      const isOutgoing = source.id === selectedNode.id;
                      const otherNode = isOutgoing ? target : source;

                      return (
                        <div
                          key={idx}
                          className="d-flex align-items-center gap-1 py-1 small"
                          style={{ cursor: 'pointer' }}
                          onClick={() => navigateToEdge(edge)}
                        >
                          {isOutgoing ? (
                            <>
                              <span className="text-muted">→</span>
                              <span className="text-secondary" style={{ fontSize: '0.75rem' }}>{formatEdgeType(edge.type)}</span>
                              <span className="text-muted">→</span>
                              <span
                                className="badge text-white text-truncate"
                                style={{ backgroundColor: getTypeColor(getEntityType(otherNode)), maxWidth: '150px', fontSize: '0.7rem' }}
                                title={otherNode.name}
                              >
                                {otherNode.name}
                              </span>
                            </>
                          ) : (
                            <>
                              <span
                                className="badge text-white text-truncate"
                                style={{ backgroundColor: getTypeColor(getEntityType(otherNode)), maxWidth: '150px', fontSize: '0.7rem' }}
                                title={otherNode.name}
                              >
                                {otherNode.name}
                              </span>
                              <span className="text-muted">→</span>
                              <span className="text-secondary" style={{ fontSize: '0.75rem' }}>{formatEdgeType(edge.type)}</span>
                              <span className="text-muted">→</span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Add Edge Button */}
              <div className="mt-3 pt-3 border-top">
                <button
                  className="btn btn-sm btn-outline-primary w-100"
                  onClick={() => openEdgeCreationFromNode(selectedNode)}
                  disabled={!selectedGroup}
                >
                  <IconPlus size={16} className="me-1" />
                  Add Relationship
                </button>
              </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Edge details */}
        {selectedEdge && (
          <div className="card position-absolute" style={{ top: '1rem', right: '1rem', width: `${panelWidth}px`, maxHeight: 'calc(100% - 2rem)', display: 'flex', flexDirection: 'column' }}>
            {/* Resize handle */}
            <div
              onMouseDown={handleResizeStart}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '6px',
                cursor: 'ew-resize',
                background: 'transparent',
              }}
              title="Drag to resize"
            />
            <div className="card-header d-flex align-items-center gap-2">
              <h4 className="card-title mb-0">Relationship Details</h4>
              {!isEditingEdge && (
                <>
                  <button
                    className="btn btn-sm btn-icon ms-auto"
                    onClick={() => startEditingEdge()}
                    title="Edit relationship"
                  >
                    <IconEdit size={16} />
                  </button>
                  <button
                    className="btn btn-sm btn-icon text-danger"
                    onClick={() => handleDeleteEdge()}
                    disabled={isSaving}
                    title="Delete relationship"
                  >
                    <IconTrashX size={16} />
                  </button>
                </>
              )}
              <button
                className={`btn btn-close ${isEditingEdge ? 'ms-auto' : ''}`}
                onClick={() => {
                  if (isEditingEdge) cancelEditingEdge();
                  else clearSelection();
                }}
              />
            </div>
            <div className="card-body" style={{ overflowY: 'auto', flex: 1 }}>
              {/* Relationship flow visualization - no box */}
              {(() => {
                const sourceNode = resolveEdgeSource(selectedEdge);
                const targetNode = resolveEdgeTarget(selectedEdge);
                return (
                  <div className="d-flex flex-wrap align-items-center justify-content-center gap-2 mb-3">
                    <span
                      className="badge text-white"
                      style={{ backgroundColor: getTypeColor(getEntityType(sourceNode)), flex: '1 1 auto', textAlign: 'center', minWidth: '80px', cursor: sourceNode ? 'pointer' : 'default' }}
                      onClick={() => sourceNode && navigateToNode(sourceNode)}
                      title="Click to view node"
                    >
                      {sourceNode?.name || 'Source'}
                    </span>
                    <span className="text-muted flex-shrink-0">→</span>
                    <span className="text-secondary" style={{ flex: '0 0 auto', textAlign: 'center' }}>{formatEdgeType(selectedEdge.type)}</span>
                    <span className="text-muted flex-shrink-0">→</span>
                    <span
                      className="badge text-white"
                      style={{ backgroundColor: getTypeColor(getEntityType(targetNode)), flex: '1 1 auto', textAlign: 'center', minWidth: '80px', cursor: targetNode ? 'pointer' : 'default' }}
                      onClick={() => targetNode && navigateToNode(targetNode)}
                      title="Click to view node"
                    >
                      {targetNode?.name || 'Target'}
                    </span>
                  </div>
                );
              })()}

              {isEditingEdge ? (
                /* Edit Mode */
                <>
                  <div className="mb-3">
                    <label className="form-label">Relationship Type</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editEdgeName}
                      onChange={e => setEditEdgeName(e.target.value)}
                      placeholder="WORKS_FOR, KNOWS, etc."
                    />
                    <small className="text-muted">This updates the relationship name (stored as uppercase)</small>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Fact Description</label>
                    <textarea
                      className="form-control"
                      rows={3}
                      value={editEdgeFact}
                      onChange={e => setEditEdgeFact(e.target.value)}
                      placeholder="Description of this relationship..."
                    />
                  </div>
                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-primary"
                      onClick={handleUpdateEdge}
                      disabled={isSaving}
                    >
                      <IconCheck size={16} className="me-1" />
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={cancelEditingEdge}
                      disabled={isSaving}
                    >
                      <IconX size={16} className="me-1" />
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                /* View Mode */
                <>
                  <div className="mb-3">
                    <label className="form-label text-muted small mb-1">Relationship Type</label>
                    <p className="mb-0">{formatEdgeType(selectedEdge.type)}</p>
                    <code className="small text-muted">{selectedEdge.type}</code>
                  </div>

                  {selectedEdge.fact && (
                    <div className="mb-3">
                      <label className="form-label text-muted small mb-1">Fact</label>
                      <p className="mb-0 small">{selectedEdge.fact}</p>
                    </div>
                  )}

              {/* Structured Metadata */}
              <div className="mb-3">
                <label className="form-label text-muted small mb-1">Metadata</label>
                <table className="table table-sm table-borderless mb-0">
                  <tbody>
                    {selectedEdge.uuid && (
                      <tr>
                        <td className="text-muted ps-0" style={{ width: '80px' }}>UUID</td>
                        <td className="small text-truncate" style={{ maxWidth: '200px' }} title={selectedEdge.uuid}>
                          <code>{selectedEdge.uuid}</code>
                        </td>
                      </tr>
                    )}
                    {selectedEdge.created_at && (
                      <tr>
                        <td className="text-muted ps-0">Created</td>
                        <td className="small">{new Date(selectedEdge.created_at).toLocaleString()}</td>
                      </tr>
                    )}
                    {selectedEdge.valid_at && (
                      <tr>
                        <td className="text-muted ps-0">Valid At</td>
                        <td className="small">{new Date(selectedEdge.valid_at).toLocaleString()}</td>
                      </tr>
                    )}
                    {selectedEdge.expired_at && (
                      <tr>
                        <td className="text-muted ps-0">Expired</td>
                        <td className="small text-danger">{new Date(selectedEdge.expired_at).toLocaleString()}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Episodes */}
              {selectedEdge.episodes && selectedEdge.episodes.length > 0 && (
                <div className="mb-3">
                  <label className="form-label text-muted small mb-1">
                    Episodes ({selectedEdge.episodes.length})
                  </label>
                  <div className="d-flex flex-column gap-2">
                    {selectedEdge.episodes.map((episodeId, idx) => (
                      <div key={idx}>
                        <div
                          className={`d-flex align-items-center gap-2 ${expandedEpisode === episodeId ? '' : 'cursor-pointer'}`}
                          style={{ cursor: 'pointer' }}
                          onClick={() => loadEpisode(episodeId, selectedEdge.group_id)}
                        >
                          {loadingEpisodes.has(episodeId) ? (
                            <span className="spinner-border spinner-border-sm text-secondary" />
                          ) : (
                            <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                              {expandedEpisode === episodeId ? '▼' : '▶'}
                            </span>
                          )}
                          <span
                            className={`badge ${expandedEpisode === episodeId ? 'bg-primary text-white' : 'bg-secondary-lt text-secondary'}`}
                            style={{ fontSize: '0.7rem' }}
                            title={episodeId}
                          >
                            {loadedEpisodes[episodeId]?.name || `${episodeId.substring(0, 8)}...`}
                          </span>
                          {loadedEpisodes[episodeId]?.source && (
                            <span className="text-muted small">{loadedEpisodes[episodeId].source}</span>
                          )}
                        </div>
                        {expandedEpisode === episodeId && loadedEpisodes[episodeId] && (
                          <div className="mt-2 p-2 rounded" style={{ background: 'var(--tblr-bg-surface-secondary)', maxHeight: '200px', overflowY: 'auto' }}>
                            {loadedEpisodes[episodeId].source_description && (
                              <div className="text-muted small mb-2">
                                {loadedEpisodes[episodeId].source_description}
                              </div>
                            )}
                            <div className="small" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {loadedEpisodes[episodeId].content || <em className="text-muted">No content</em>}
                            </div>
                            {loadedEpisodes[episodeId].valid_at && (
                              <div className="text-muted small mt-2">
                                Valid: {new Date(loadedEpisodes[episodeId].valid_at!).toLocaleString()}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Node Modal */}
      {showCreateNodeModal && (
        <div className="modal modal-blur fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Create New Entity</h5>
                <button type="button" className="btn-close" onClick={() => setShowCreateNodeModal(false)} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label required">Name</label>
                  <input
                    type="text"
                    className="form-control"
                    value={newNodeName}
                    onChange={e => setNewNodeName(e.target.value)}
                    placeholder="Entity name"
                    autoFocus
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">Type</label>
                  {entityTypes.length > 0 ? (
                    <>
                      <select
                        className="form-select"
                        value={selectedEntityType?.name || '__custom__'}
                        onChange={e => handleEntityTypeChange(e.target.value)}
                      >
                        <option value="__custom__">Custom Type...</option>
                        {entityTypes.slice().sort((a, b) => a.name.localeCompare(b.name)).map(et => (
                          <option key={et.name} value={et.name}>
                            {et.name}
                          </option>
                        ))}
                      </select>
                      {selectedEntityType && (
                        <small className="text-muted">{selectedEntityType.description}</small>
                      )}
                      {!selectedEntityType && (
                        <input
                          type="text"
                          className="form-control mt-2"
                          value={newNodeType}
                          onChange={e => setNewNodeType(e.target.value)}
                          placeholder="Enter custom type (e.g., Person, Organization)"
                        />
                      )}
                    </>
                  ) : (
                    <>
                      <input
                        type="text"
                        className="form-control"
                        value={newNodeType}
                        onChange={e => setNewNodeType(e.target.value)}
                        placeholder="Person, Organization, etc."
                      />
                      <small className="text-muted">Leave empty for default "Entity" type</small>
                    </>
                  )}
                </div>

                {/* Dynamic fields based on selected entity type */}
                {selectedEntityType && selectedEntityType.fields && selectedEntityType.fields.length > 0 && (
                  <div className="mb-3">
                    <label className="form-label">Attributes</label>
                    <div className="border rounded p-3" style={{ background: 'var(--tblr-bg-surface-secondary)' }}>
                      {selectedEntityType.fields.map(field => (
                        <div key={field.name} className="mb-2">
                          <label className={`form-label small ${field.required ? 'required' : ''}`}>
                            {field.name}
                            {field.description && (
                              <span className="text-muted ms-1" title={field.description}>
                                ({field.type})
                              </span>
                            )}
                          </label>
                          {field.type === 'bool' ? (
                            <select
                              className="form-select form-select-sm"
                              value={nodeAttributes[field.name] || ''}
                              onChange={e => setNodeAttributes(prev => ({ ...prev, [field.name]: e.target.value }))}
                            >
                              <option value="">-- Select --</option>
                              <option value="true">Yes</option>
                              <option value="false">No</option>
                            </select>
                          ) : (
                            <input
                              type={field.type === 'int' || field.type === 'float' ? 'number' : 'text'}
                              className="form-control form-control-sm"
                              value={nodeAttributes[field.name] || ''}
                              onChange={e => setNodeAttributes(prev => ({ ...prev, [field.name]: e.target.value }))}
                              placeholder={field.description || field.name}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mb-3">
                  <label className="form-label">Summary</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    value={newNodeSummary}
                    onChange={e => setNewNodeSummary(e.target.value)}
                    placeholder="Brief description of this entity..."
                  />
                </div>
                <div className="mb-0">
                  <label className="form-label">Target Graph</label>
                  <input
                    type="text"
                    className="form-control"
                    value={selectedGroup}
                    disabled
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateNodeModal(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCreateNode}
                  disabled={isSaving || !newNodeName.trim()}
                >
                  {isSaving ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Edge Modal */}
      {showCreateEdgeModal && (
        <div className="modal modal-blur fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Create Relationship</h5>
                <button type="button" className="btn-close" onClick={() => {
                  setShowCreateEdgeModal(false);
                  setEdgeSourceNode(null);
                  setEdgeTargetNode(null);
                }} />
              </div>
              <div className="modal-body">
                {/* Source/Target Visualization */}
                <div className="d-flex align-items-center justify-content-center gap-2 mb-4 p-3 rounded" style={{ background: 'var(--tblr-bg-surface-secondary)' }}>
                  <span
                    className="badge text-white"
                    style={{ backgroundColor: edgeSourceNode ? getTypeColor(getEntityType(edgeSourceNode)) : '#667382' }}
                  >
                    {edgeSourceNode?.name || 'Select source...'}
                  </span>
                  <span className="text-muted">→</span>
                  <span
                    className="badge text-white"
                    style={{ backgroundColor: edgeTargetNode ? getTypeColor(getEntityType(edgeTargetNode)) : '#667382' }}
                  >
                    {edgeTargetNode?.name || 'Select target...'}
                  </span>
                </div>

                <div className="row mb-3">
                  <div className="col-6">
                    <label className="form-label required">Source Node</label>
                    <select
                      className="form-select"
                      value={edgeSourceNode?.id || ''}
                      onChange={e => {
                        const node = graphData?.nodes.find(n => n.id === e.target.value);
                        setEdgeSourceNode(node || null);
                      }}
                    >
                      <option value="">Select source...</option>
                      {graphData?.nodes.slice().sort((a, b) => a.name.localeCompare(b.name)).map(n => (
                        <option key={n.id} value={n.id}>{n.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-6">
                    <label className="form-label required">Target Node</label>
                    <select
                      className="form-select"
                      value={edgeTargetNode?.id || ''}
                      onChange={e => {
                        const node = graphData?.nodes.find(n => n.id === e.target.value);
                        setEdgeTargetNode(node || null);
                      }}
                    >
                      <option value="">Select target...</option>
                      {graphData?.nodes.slice().sort((a, b) => a.name.localeCompare(b.name)).map(n => (
                        <option key={n.id} value={n.id}>{n.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mb-3">
                  <label className="form-label required">Relationship Type</label>
                  <input
                    type="text"
                    className="form-control"
                    value={newEdgeType}
                    onChange={e => setNewEdgeType(e.target.value)}
                    placeholder="WORKS_FOR, KNOWS, LOCATED_IN, etc."
                  />
                  <small className="text-muted">Will be converted to UPPER_SNAKE_CASE</small>
                </div>

                <div className="mb-0">
                  <label className="form-label">Fact Description</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    value={newEdgeFact}
                    onChange={e => setNewEdgeFact(e.target.value)}
                    placeholder="Describe the relationship (e.g., 'John has worked at Acme since 2020')..."
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => {
                  setShowCreateEdgeModal(false);
                  setEdgeSourceNode(null);
                  setEdgeTargetNode(null);
                }}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCreateEdge}
                  disabled={isSaving || !edgeSourceNode || !edgeTargetNode || !newEdgeType.trim()}
                >
                  {isSaving ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Send Knowledge Modal */}
      {showSendKnowledgeModal && (
        <div className="modal modal-blur fade show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <IconBrain size={20} className="me-2" />
                  Send Knowledge to LLM
                </h5>
                <button type="button" className="btn-close" onClick={() => setShowSendKnowledgeModal(false)} />
              </div>
              <div className="modal-body">
                <div className="alert alert-info mb-3">
                  <strong>LLM Mode:</strong> The AI will analyze your text and automatically extract entities and relationships.
                  Results will appear after processing (may take a few seconds).
                </div>
                <div className="mb-3">
                  <label className="form-label required">Knowledge Text</label>
                  <textarea
                    className="form-control"
                    rows={10}
                    value={knowledgeContent}
                    onChange={e => setKnowledgeContent(e.target.value)}
                    placeholder="Enter free-form text describing people, organizations, relationships, events, etc.

Example:
John Smith is a software engineer at Acme Corp. He has been working there since 2020 and leads the backend team. Acme Corp is headquartered in San Francisco and was founded by Jane Doe in 2015."
                    autoFocus
                  />
                </div>
                <div className="mb-0">
                  <label className="form-label">Target Graph</label>
                  <input
                    type="text"
                    className="form-control"
                    value={selectedGroup}
                    disabled
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowSendKnowledgeModal(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSendKnowledge}
                  disabled={isSaving || !knowledgeContent.trim()}
                >
                  {isSaving ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <IconBrain size={16} className="me-1" />
                      Send to LLM
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Graph Modal */}
      {showCreateGraphModal && (
        <div className="modal modal-blur show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-sm modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Create New Graph</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => { setShowCreateGraphModal(false); setNewGraphId(''); }}
                />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label">Graph ID</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. my-project, user-123"
                    value={newGraphId}
                    onChange={e => setNewGraphId(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateGraph()}
                    autoFocus
                  />
                  <div className="form-text">
                    {groups.includes(newGraphId.trim())
                      ? <span className="text-warning">Graph exists - will be selected</span>
                      : 'Graph will be created when you add nodes or edges'}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="btn"
                  onClick={() => { setShowCreateGraphModal(false); setNewGraphId(''); }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleCreateGraph}
                  disabled={!newGraphId.trim()}
                >
                  {groups.includes(newGraphId.trim()) ? 'Select Graph' : 'Create Graph'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rename Graph Modal */}
      {showRenameGraphModal && (
        <div className="modal modal-blur show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-sm modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Rename Graph</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => { setShowRenameGraphModal(false); setRenameGraphNewName(''); }}
                />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label">Current Name</label>
                  <input
                    type="text"
                    className="form-control"
                    value={selectedGroup}
                    disabled
                  />
                </div>
                <div className="mb-0">
                  <label className="form-label">New Name</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Enter new graph name"
                    value={renameGraphNewName}
                    onChange={e => setRenameGraphNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleRenameGraph()}
                    autoFocus
                  />
                  {groups.includes(renameGraphNewName.trim()) && renameGraphNewName.trim() !== selectedGroup && (
                    <div className="form-text text-warning">A graph with this name already exists</div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="btn"
                  onClick={() => { setShowRenameGraphModal(false); setRenameGraphNewName(''); }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleRenameGraph}
                  disabled={isSaving || !renameGraphNewName.trim() || renameGraphNewName.trim() === selectedGroup || groups.includes(renameGraphNewName.trim())}
                >
                  {isSaving ? 'Renaming...' : 'Rename'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Graph Confirmation Modal */}
      {showDeleteGraphConfirm && (
        <div className="modal modal-blur show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-sm modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-status bg-danger" />
              <div className="modal-body text-center py-4">
                <IconAlertTriangle size={48} className="text-danger mb-3" />
                <h3>Delete Graph?</h3>
                <div className="text-secondary">
                  Are you sure you want to delete <strong>"{selectedGroup}"</strong>?
                  <br /><br />
                  This will permanently delete all nodes and edges in this graph.
                </div>
              </div>
              <div className="modal-footer">
                <div className="w-100">
                  <div className="row">
                    <div className="col">
                      <button className="btn w-100" onClick={() => setShowDeleteGraphConfirm(false)} disabled={isDeleting}>
                        Cancel
                      </button>
                    </div>
                    <div className="col">
                      <button className="btn btn-danger w-100" onClick={confirmDeleteGraph} disabled={isDeleting}>
                        {isDeleting ? <><span className="spinner-border spinner-border-sm me-2" />Deleting...</> : 'Yes, Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Node Confirmation Modal */}
      {showDeleteNodeConfirm && selectedNode && (
        <div className="modal modal-blur show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-sm modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-status bg-danger" />
              <div className="modal-body text-center py-4">
                <IconAlertTriangle size={48} className="text-danger mb-3" />
                <h3>Delete Node?</h3>
                <div className="text-secondary">
                  Are you sure you want to delete <strong>"{selectedNode.name}"</strong>?
                  <br /><br />
                  This will also remove all connected relationships.
                </div>
              </div>
              <div className="modal-footer">
                <div className="w-100">
                  <div className="row">
                    <div className="col">
                      <button className="btn w-100" onClick={() => setShowDeleteNodeConfirm(false)} disabled={isSaving}>
                        Cancel
                      </button>
                    </div>
                    <div className="col">
                      <button className="btn btn-danger w-100" onClick={confirmDeleteNode} disabled={isSaving}>
                        {isSaving ? <><span className="spinner-border spinner-border-sm me-2" />Deleting...</> : 'Yes, Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Edge Confirmation Modal */}
      {showDeleteEdgeConfirm && selectedEdge && (
        <div className="modal modal-blur show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-sm modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-status bg-danger" />
              <div className="modal-body text-center py-4">
                <IconAlertTriangle size={48} className="text-danger mb-3" />
                <h3>Delete Relationship?</h3>
                <div className="text-secondary">
                  Are you sure you want to delete <strong>"{formatEdgeType(selectedEdge.type)}"</strong>?
                </div>
              </div>
              <div className="modal-footer">
                <div className="w-100">
                  <div className="row">
                    <div className="col">
                      <button className="btn w-100" onClick={() => setShowDeleteEdgeConfirm(false)} disabled={isSaving}>
                        Cancel
                      </button>
                    </div>
                    <div className="col">
                      <button className="btn btn-danger w-100" onClick={confirmDeleteEdge} disabled={isSaving}>
                        {isSaving ? <><span className="spinner-border spinner-border-sm me-2" />Deleting...</> : 'Yes, Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Alert Modal */}
      {alertMessage && (
        <div className="modal modal-blur show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-sm modal-dialog-centered">
            <div className="modal-content">
              <div className={`modal-status ${alertMessage.type === 'error' ? 'bg-danger' : alertMessage.type === 'success' ? 'bg-success' : 'bg-info'}`} />
              <div className="modal-body text-center py-4">
                <IconAlertTriangle size={48} className={`mb-3 ${alertMessage.type === 'error' ? 'text-danger' : alertMessage.type === 'success' ? 'text-success' : 'text-info'}`} />
                <h3>{alertMessage.title}</h3>
                <div className="text-secondary">{alertMessage.message}</div>
              </div>
              <div className="modal-footer">
                <button className="btn w-100" onClick={() => setAlertMessage(null)}>
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

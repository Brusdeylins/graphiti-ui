import { useState, useEffect } from 'react';
import { api } from '../api/client';
import { IconCategory, IconInfoCircle, IconChevronDown, IconChevronRight, IconPlus, IconEdit, IconTrash, IconX, IconCheck, IconRefresh, IconAlertTriangle } from '@tabler/icons-react';

interface EntityTypeField {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface EntityType {
  name: string;
  description: string;
  fields?: EntityTypeField[];
  source?: string;
  created_at?: string;
  modified_at?: string;
}

const FIELD_TYPES = ['str', 'int', 'float', 'bool'];

// Protected field names that conflict with Graphiti's internal EntityNode attributes
const PROTECTED_FIELD_NAMES = new Set([
  'name', 'summary', 'uuid', 'created_at', 'group_id',
  'labels', 'attributes', 'name_embedding', 'summary_embedding',
]);

export function EntityTypesPage() {
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingType, setEditingType] = useState<EntityType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Reset confirmation state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formFields, setFormFields] = useState<EntityTypeField[]>([]);

  const fetchEntityTypes = async () => {
    try {
      setIsLoading(true);
      const response = await api.get('/entity-types');
      setEntityTypes(response.data || []);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load entity types');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEntityTypes();
  }, []);

  const toggleExpand = (name: string) => {
    setExpandedTypes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(name)) {
        newSet.delete(name);
      } else {
        newSet.add(name);
      }
      return newSet;
    });
  };

  const openCreateModal = () => {
    setModalMode('create');
    setEditingType(null);
    setFormName('');
    setFormDescription('');
    setFormFields([]);
    setShowModal(true);
  };

  const openEditModal = (type: EntityType) => {
    setModalMode('edit');
    setEditingType(type);
    setFormName(type.name);
    setFormDescription(type.description);
    setFormFields(type.fields ? [...type.fields] : []);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingType(null);
  };

  const addField = () => {
    setFormFields([...formFields, { name: '', type: 'str', required: false, description: '' }]);
  };

  const updateField = (index: number, updates: Partial<EntityTypeField>) => {
    const newFields = [...formFields];
    newFields[index] = { ...newFields[index], ...updates };
    setFormFields(newFields);
  };

  const removeField = (index: number) => {
    setFormFields(formFields.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!formName.trim() || !formDescription.trim()) {
      setError('Name and description are required');
      return;
    }

    // Validate fields
    const validFields = formFields.filter(f => f.name.trim());

    // Check for protected field names
    const protectedFields = validFields.filter(f => PROTECTED_FIELD_NAMES.has(f.name.toLowerCase()));
    if (protectedFields.length > 0) {
      const names = protectedFields.map(f => `"${f.name}"`).join(', ');
      setError(`Reserved field name(s): ${names}. These are internal Graphiti attributes.`);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      if (modalMode === 'create') {
        await api.post('/entity-types', {
          name: formName.trim(),
          description: formDescription.trim(),
          fields: validFields,
        });
      } else if (editingType) {
        await api.put(`/entity-types/${editingType.name}`, {
          description: formDescription.trim(),
          fields: validFields,
        });
      }
      closeModal();
      fetchEntityTypes();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to save entity type');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?\n\nThis cannot be undone.`)) {
      return;
    }

    try {
      await api.delete(`/entity-types/${name}`);
      fetchEntityTypes();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to delete entity type');
    }
  };

  const handleReset = async () => {
    setIsResetting(true);
    setError(null);

    try {
      await api.post('/entity-types/reset');
      setShowResetConfirm(false);
      fetchEntityTypes();
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.detail || 'Failed to reset entity types');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="page-header d-print-none">
      <div className="row align-items-center mb-4">
        <div className="col">
          <h2 className="page-title">Entity Types</h2>
          <div className="text-secondary mt-1">
            Manage entity types for knowledge extraction
          </div>
        </div>
        <div className="col-auto">
          <button className="btn btn-outline-danger me-2" onClick={() => setShowResetConfirm(true)}>
            <IconRefresh size={18} className="me-1" />
            Reset to Defaults
          </button>
          <button className="btn btn-primary" onClick={openCreateModal}>
            <IconPlus size={18} className="me-1" />
            New Entity Type
          </button>
        </div>
      </div>

      <div className="alert alert-info mb-4">
        <div className="d-flex">
          <IconInfoCircle size={20} className="me-2 flex-shrink-0" />
          <div>
            Entity types define what kinds of entities the LLM extracts from text.
            Changes are stored in the database and take effect immediately.
            Initial types are seeded from <code>config.yaml</code> on first startup.
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger alert-dismissible" role="alert">
          {error}
          <button type="button" className="btn-close" onClick={() => setError(null)} />
        </div>
      )}

      {isLoading ? (
        <div className="card">
          <div className="card-body text-center py-5">
            <div className="spinner-border text-primary" role="status" />
            <p className="mt-3 text-secondary">Loading entity types...</p>
          </div>
        </div>
      ) : entityTypes.length === 0 ? (
        <div className="card">
          <div className="card-body text-center py-5">
            <IconCategory size={48} className="text-secondary mb-3" />
            <p className="text-secondary mb-3">No entity types configured.</p>
            <button className="btn btn-primary" onClick={openCreateModal}>
              <IconPlus size={18} className="me-1" />
              Create First Entity Type
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-vcenter card-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}></th>
                  <th>Name</th>
                  <th>Description (LLM Prompt)</th>
                  <th style={{ width: '100px' }}>Fields</th>
                  <th style={{ width: '80px' }}>Source</th>
                  <th style={{ width: '120px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {entityTypes.map((type) => {
                  const hasFields = type.fields && type.fields.length > 0;
                  const isExpanded = expandedTypes.has(type.name);
                  return (
                    <>
                      <tr key={type.name}>
                        <td
                          className="text-center"
                          style={{ cursor: hasFields ? 'pointer' : 'default' }}
                          onClick={() => hasFields && toggleExpand(type.name)}
                        >
                          {hasFields && (
                            isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />
                          )}
                        </td>
                        <td><code>{type.name}</code></td>
                        <td className="text-secondary">{type.description || '-'}</td>
                        <td>
                          {hasFields ? (
                            <span className="badge bg-blue-lt">{type.fields!.length} fields</span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${
                            type.source === 'config' ? 'bg-secondary-lt' :
                            type.source === 'config_modified' ? 'bg-yellow-lt' :
                            'bg-green-lt'
                          }`}>
                            {type.source === 'config_modified' ? 'config modified' : (type.source || 'user')}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-sm btn-ghost-primary me-1"
                            onClick={() => openEditModal(type)}
                            title="Edit"
                          >
                            <IconEdit size={16} />
                          </button>
                          <button
                            className="btn btn-sm btn-ghost-danger"
                            onClick={() => handleDelete(type.name)}
                            title="Delete"
                          >
                            <IconTrash size={16} />
                          </button>
                        </td>
                      </tr>
                      {hasFields && isExpanded && (
                        <tr key={`${type.name}-fields`}>
                          <td colSpan={6} className="p-0" style={{ backgroundColor: 'var(--tblr-bg-surface-secondary)' }}>
                            <table className="table table-sm mb-0">
                              <thead>
                                <tr style={{ backgroundColor: 'var(--tblr-bg-surface-tertiary)' }}>
                                  <th style={{ width: '80px' }}></th>
                                  <th style={{ width: '150px', paddingLeft: '2rem' }}>Field</th>
                                  <th style={{ width: '80px' }}>Type</th>
                                  <th style={{ width: '80px' }}>Required</th>
                                  <th>Description</th>
                                </tr>
                              </thead>
                              <tbody>
                                {type.fields!.map((field) => (
                                  <tr key={field.name} style={{ backgroundColor: 'var(--tblr-bg-surface-secondary)' }}>
                                    <td></td>
                                    <td style={{ paddingLeft: '2rem' }}><code className="text-pink">{field.name}</code></td>
                                    <td><code>{field.type}</code></td>
                                    <td>{field.required ? <span className="badge bg-yellow-lt">required</span> : <span className="text-muted">optional</span>}</td>
                                    <td className="text-secondary small">{field.description || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal modal-blur show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {modalMode === 'create' ? 'Create Entity Type' : `Edit "${editingType?.name}"`}
                </h5>
                <button type="button" className="btn-close" onClick={closeModal} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label required">Name</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="PascalCase, e.g. PersonContact"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    disabled={modalMode === 'edit'}
                    pattern="^[A-Z][a-zA-Z0-9]*$"
                  />
                  <small className="text-muted">Must be PascalCase (start with uppercase letter)</small>
                </div>

                <div className="mb-3">
                  <label className="form-label required">Description</label>
                  <textarea
                    className="form-control"
                    rows={2}
                    placeholder="Description used as LLM prompt for entity extraction"
                    value={formDescription}
                    onChange={e => setFormDescription(e.target.value)}
                  />
                  <small className="text-muted">This is shown to the LLM to guide entity extraction</small>
                </div>

                <div className="mb-3">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <label className="form-label mb-0">Fields (optional)</label>
                    <button className="btn btn-sm btn-outline-primary" onClick={addField}>
                      <IconPlus size={14} className="me-1" />
                      Add Field
                    </button>
                  </div>

                  {formFields.length === 0 ? (
                    <div className="text-muted small p-3 border rounded">
                      No fields defined. Fields allow structured attribute extraction.
                    </div>
                  ) : (
                    <div className="border rounded">
                      {formFields.map((field, index) => (
                        <div key={index} className={`p-2 ${index > 0 ? 'border-top' : ''}`}>
                          <div className="row g-2 align-items-center">
                            <div className="col-3">
                              <input
                                type="text"
                                className="form-control form-control-sm"
                                placeholder="Field name"
                                value={field.name}
                                onChange={e => updateField(index, { name: e.target.value })}
                              />
                            </div>
                            <div className="col-2">
                              <select
                                className="form-select form-select-sm"
                                value={field.type}
                                onChange={e => updateField(index, { type: e.target.value })}
                              >
                                {FIELD_TYPES.map(t => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            </div>
                            <div className="col-2">
                              <label className="form-check form-check-inline mb-0">
                                <input
                                  type="checkbox"
                                  className="form-check-input"
                                  checked={field.required}
                                  onChange={e => updateField(index, { required: e.target.checked })}
                                />
                                <span className="form-check-label small">Required</span>
                              </label>
                            </div>
                            <div className="col-4">
                              <input
                                type="text"
                                className="form-control form-control-sm"
                                placeholder="Description"
                                value={field.description}
                                onChange={e => updateField(index, { description: e.target.value })}
                              />
                            </div>
                            <div className="col-1 text-end">
                              <button
                                className="btn btn-sm btn-ghost-danger"
                                onClick={() => removeField(index)}
                              >
                                <IconX size={14} />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={closeModal}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={isSaving || !formName.trim() || !formDescription.trim()}
                >
                  {isSaving ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <IconCheck size={18} className="me-1" />
                      {modalMode === 'create' ? 'Create' : 'Save Changes'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="modal modal-blur show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-sm modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-status bg-danger" />
              <div className="modal-body text-center py-4">
                <IconAlertTriangle size={48} className="text-danger mb-3" />
                <h3>Reset to Defaults?</h3>
                <div className="text-secondary">
                  This will <strong>delete all entity types</strong> and reload them from <code>config.yaml</code>.
                  <br /><br />
                  Any custom entity types you created will be lost.
                </div>
              </div>
              <div className="modal-footer">
                <div className="w-100">
                  <div className="row">
                    <div className="col">
                      <button className="btn w-100" onClick={() => setShowResetConfirm(false)} disabled={isResetting}>
                        Cancel
                      </button>
                    </div>
                    <div className="col">
                      <button className="btn btn-danger w-100" onClick={handleReset} disabled={isResetting}>
                        {isResetting ? (
                          <>
                            <span className="spinner-border spinner-border-sm me-2" />
                            Resetting...
                          </>
                        ) : (
                          'Yes, Reset'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

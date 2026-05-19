import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Box, 
  Container, 
  Trash2, 
  HardDrive, 
  RefreshCw, 
  AlertCircle,
  Clock,
  Layers,
  ChevronRight,
  Key,
  X,
  Info
} from 'lucide-react';

interface RegistryResponse {
  repositories: string[];
}

interface TagsResponse {
  name: string;
  tags: string[];
}

interface Manifest {
  schemaVersion: number;
  config?: {
    size: number;
    digest: string;
  };
  layers?: Array<{
    size: number;
    digest: string;
  }>;
  created?: string;
  architecture?: string;
  os?: string;
  digest?: string;
  error?: string;
  errorType?: 'auth' | 'delete_disabled' | 'generic';
}

const api = axios.create({
  baseURL: '/v2',
  headers: {
    Accept: 'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json'
  }
});

// Configure Basic Auth Interceptor dynamically
api.interceptors.request.use(config => {
  const user = localStorage.getItem('registry_username');
  const pass = localStorage.getItem('registry_password');
  if (user && pass) {
    config.headers.Authorization = `Basic ${btoa(`${user}:${pass}`)}`;
  } else {
    delete config.headers.Authorization;
  }
  return config;
});

function App() {
  const [repositories, setRepositories] = useState<string[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [manifests, setManifests] = useState<Record<string, Manifest>>({});
  
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  
  // Error handling
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<'auth' | 'delete_disabled' | 'generic' | null>(null);

  // Modals state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showDeleteFixModal, setShowDeleteFixModal] = useState(false);

  // Form state
  const [usernameInput, setUsernameInput] = useState(localStorage.getItem('registry_username') || '');
  const [passwordInput, setPasswordInput] = useState(localStorage.getItem('registry_password') || '');

  useEffect(() => {
    fetchRepositories();
  }, []);

  useEffect(() => {
    if (selectedRepo) {
      fetchTags(selectedRepo);
    }
  }, [selectedRepo]);

  const classifyError = (err: any): 'auth' | 'delete_disabled' | 'generic' => {
    const status = err.response?.status;
    const message = (err.response?.data?.errors?.[0]?.message || err.message || '').toLowerCase();
    
    if (status === 401 || message.includes('unauthorized') || message.includes('credentials')) {
      return 'auth';
    }
    if (status === 405 || message.includes('method not allowed') || message.includes('delete is disabled') || message.includes('delete disabled')) {
      return 'delete_disabled';
    }
    return 'generic';
  };

  const getErrorMessage = (err: any): string => {
    const type = classifyError(err);
    if (type === 'auth') return 'Authentication required. Please configure registry credentials.';
    if (type === 'delete_disabled') return 'Registry deletion is disabled in the server settings.';
    return err.response?.data?.errors?.[0]?.message || err.message || 'An unexpected error occurred';
  };

  const fetchRepositories = async () => {
    setLoadingRepos(true);
    setError(null);
    setErrorType(null);
    try {
      const response = await api.get<RegistryResponse>('/_catalog');
      setRepositories(response.data.repositories || []);
      if (!selectedRepo && response.data.repositories?.length > 0) {
        setSelectedRepo(response.data.repositories[0]);
      }
    } catch (err: any) {
      const type = classifyError(err);
      setErrorType(type);
      setError(getErrorMessage(err));
    } finally {
      setLoadingRepos(false);
    }
  };

  const fetchTags = async (repo: string) => {
    setLoadingTags(true);
    setError(null);
    setErrorType(null);
    setTags([]);
    setManifests({});
    
    try {
      const response = await api.get<TagsResponse>(`/${repo}/tags/list`);
      const repoTags = response.data.tags || [];
      setTags(repoTags);
      
      repoTags.forEach(tag => fetchManifest(repo, tag));
    } catch (err: any) {
      const type = classifyError(err);
      setErrorType(type);
      setError(getErrorMessage(err));
    } finally {
      setLoadingTags(false);
    }
  };

  const fetchManifest = async (repo: string, tag: string) => {
    try {
      const response = await api.get(`/${repo}/manifests/${tag}`);
      const digest = response.headers['docker-content-digest'];
      
      let created = '';
      if (response.data.history && response.data.history.length > 0) {
        const v1Compatibility = JSON.parse(response.data.history[0].v1Compatibility);
        created = v1Compatibility.created;
      }
      
      setManifests(prev => ({
        ...prev,
        [tag]: {
          ...response.data,
          digest: digest || response.data?.config?.digest,
          created: created
        }
      }));
    } catch (err: any) {
      console.error(`Failed to fetch manifest for ${repo}:${tag}`, err);
      const type = classifyError(err);
      setManifests(prev => ({
        ...prev,
        [tag]: {
          schemaVersion: 0,
          error: getErrorMessage(err),
          errorType: type
        }
      }));
    }
  };

  const handleDelete = async (repo: string, tag: string, digest: string) => {
    if (!window.confirm(`Are you sure you want to delete ${repo}:${tag}? This cannot be undone.`)) {
      return;
    }
    
    setDeleting(tag);
    setError(null);
    setErrorType(null);
    
    try {
      await api.delete(`/${repo}/manifests/${digest}`);
      fetchTags(repo);
    } catch (err: any) {
      const type = classifyError(err);
      setErrorType(type);
      setError(getErrorMessage(err));
      
      if (type === 'delete_disabled') {
        setShowDeleteFixModal(true);
      }
    } finally {
      setDeleting(null);
    }
  };

  const handleSaveCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    if (usernameInput.trim()) {
      localStorage.setItem('registry_username', usernameInput.trim());
      localStorage.setItem('registry_password', passwordInput.trim());
    } else {
      localStorage.removeItem('registry_username');
      localStorage.removeItem('registry_password');
    }
    setShowAuthModal(false);
    // Reload state
    fetchRepositories();
  };

  const handleFixError = (type: 'auth' | 'delete_disabled' | 'generic') => {
    if (type === 'auth') {
      setShowAuthModal(true);
    } else if (type === 'delete_disabled') {
      setShowDeleteFixModal(true);
    } else {
      fetchRepositories();
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return 'Unknown';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Byte';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)).toString());
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const calculateTotalSize = (manifest: Manifest) => {
    if (manifest.layers) {
      return formatSize(manifest.layers.reduce((acc, layer) => acc + layer.size, 0));
    }
    return 'Unknown';
  };

  return (
    <div className="container">
      <header className="header">
        <h1 className="title">
          <Container className="primary-icon" color="var(--primary)" size={32} />
          Docker Registry Manager
        </h1>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button 
            className="btn" 
            style={{ background: 'var(--border)', color: 'var(--text-main)' }} 
            onClick={() => setShowAuthModal(true)}
            title="Configure Credentials"
          >
            <Key size={16} />
            Credentials
          </button>
          <button className="btn" style={{ background: 'var(--border)', color: 'var(--text-main)' }} onClick={fetchRepositories}>
            <RefreshCw size={16} className={loadingRepos ? 'spinner' : ''} />
            Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="error-message" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
          {errorType && (
            <button 
              className="btn" 
              style={{ background: 'var(--primary)', color: 'white' }}
              onClick={() => handleFixError(errorType)}
            >
              {errorType === 'auth' ? 'Fix: Enter Credentials' : errorType === 'delete_disabled' ? 'Fix: Enable Deletes' : 'Retry'}
            </button>
          )}
        </div>
      )}

      <div className="grid">
        <aside>
          <div className="card">
            <h2 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Layers size={20} /> Repositories
            </h2>
            
            {loadingRepos ? (
              <div className="loading">
                <RefreshCw className="spinner" size={24} />
              </div>
            ) : repositories.length === 0 ? (
              <p className="text-muted">No repositories found.</p>
            ) : (
              <>
                <div className="repo-list-desktop">
                  {repositories.map(repo => (
                    <button 
                      key={repo}
                      className={`repo-item ${selectedRepo === repo ? 'active' : ''}`}
                      onClick={() => setSelectedRepo(repo)}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo}</span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </div>
                <div className="repo-list-mobile">
                  <select 
                    value={selectedRepo || ''} 
                    onChange={(e) => setSelectedRepo(e.target.value)}
                  >
                    {repositories.map(repo => (
                      <option key={repo} value={repo}>
                        {repo}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </div>
        </aside>

        <main>
          <div className="card" style={{ minHeight: '400px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.5rem' }}>{selectedRepo || 'Select a Repository'}</h2>
              {selectedRepo && (
                <button className="btn" style={{ background: 'transparent', border: '1px solid var(--border)' }} onClick={() => fetchTags(selectedRepo)}>
                  <RefreshCw size={14} className={loadingTags ? 'spinner' : ''} />
                  Refresh Tags
                </button>
              )}
            </div>

            {!selectedRepo ? (
              <div className="empty-state">
                <Box size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                <h3>No Repository Selected</h3>
                <p>Select a repository from the sidebar to view its images.</p>
              </div>
            ) : loadingTags ? (
              <div className="loading">
                <RefreshCw className="spinner" size={32} />
                <p>Loading tags...</p>
              </div>
            ) : tags.length === 0 ? (
              <div className="empty-state">
                <Box size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                <h3>No Images Found</h3>
                <p>This repository doesn't have any tagged images.</p>
              </div>
            ) : (
              <div className="tags-grid">
                {tags.map(tag => {
                  const manifest = manifests[tag];
                  return (
                    <div key={tag} className="card tag-card" style={{ background: 'var(--bg)' }}>
                      <div className="tag-header">
                        <div className="tag-name" title={tag}>
                          <Box size={18} color="var(--primary)" style={{ flexShrink: 0 }} />
                          <span>{tag}</span>
                        </div>
                        <button 
                          className="btn btn-danger"
                          disabled={deleting === tag || !manifest?.digest}
                          onClick={() => manifest?.digest && handleDelete(selectedRepo, tag, manifest.digest)}
                          title={!manifest?.digest ? "Cannot delete without digest" : "Delete image"}
                        >
                          {deleting === tag ? <RefreshCw size={16} className="spinner" /> : <Trash2 size={16} />}
                        </button>
                      </div>
                      
                      <div className="tag-meta">
                        {manifest ? (
                          manifest.error ? (
                            <div className="meta-item error-message" style={{ margin: 0, padding: '0.5rem', fontSize: '0.875rem', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                                <span>{manifest.error}</span>
                              </div>
                              {manifest.errorType && (
                                <button 
                                  className="btn" 
                                  style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', background: 'var(--primary)', color: 'white', alignSelf: 'flex-start' }}
                                  onClick={() => handleFixError(manifest.errorType!)}
                                >
                                  {manifest.errorType === 'auth' ? 'Fix: Enter Credentials' : manifest.errorType === 'delete_disabled' ? 'Fix: Enable Deletes' : 'Retry'}
                                </button>
                              )}
                            </div>
                          ) : (
                            <>
                              <div className="meta-item">
                                <HardDrive size={14} />
                                Size: {calculateTotalSize(manifest)}
                              </div>
                              {(manifest.architecture || manifest.os) && (
                                <div className="meta-item">
                                  <Layers size={14} />
                                  OS/Arch: {manifest.os}/{manifest.architecture}
                                </div>
                              )}
                              {manifest.created && (
                                <div className="meta-item">
                                  <Clock size={14} />
                                  Created: {new Date(manifest.created).toLocaleDateString()}
                                </div>
                              )}
                              <div className="meta-item" style={{ marginTop: '0.5rem', fontSize: '0.75rem', opacity: 0.7, wordBreak: 'break-all' }}>
                                Digest: {manifest.digest ? manifest.digest.substring(0, 15) + '...' : 'Unknown'}
                              </div>
                            </>
                          )
                        ) : (
                          <div className="meta-item">
                            <RefreshCw size={14} className="spinner" />
                            Loading details...
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Registry Credentials</h3>
              <button style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setShowAuthModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveCredentials} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="form-group">
                <label>Username</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={usernameInput} 
                  onChange={e => setUsernameInput(e.target.value)} 
                  placeholder="e.g. admin"
                />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input 
                  type="password" 
                  className="form-input" 
                  value={passwordInput} 
                  onChange={e => setPasswordInput(e.target.value)} 
                  placeholder="Enter Password"
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn" style={{ background: 'var(--border)', color: 'var(--text-main)' }} onClick={() => setShowAuthModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn" style={{ background: 'var(--primary)', color: 'white' }}>
                  Save & Apply
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enable Delete Modal */}
      {showDeleteFixModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3 className="modal-title">How to Enable Image Deletion</h3>
              <button style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => setShowDeleteFixModal(false)}>
                <X size={20} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.925rem' }}>
              <p>Docker registries disable deletions by default to protect image data. To fix this, you must explicitly enable it on your registry server.</p>
              
              <h4 style={{ color: 'var(--primary)' }}>Option A: Docker Compose (Recommended)</h4>
              <p>Add the following environment variable to your registry container definition:</p>
              <pre className="code-block">
{`services:
  registry:
    image: registry:2
    environment:
      REGISTRY_STORAGE_DELETE_ENABLED: "true"`}
              </pre>

              <h4 style={{ color: 'var(--primary)' }}>Option B: Registry Config File</h4>
              <p>If you are using a config file (`config.yml`), ensure the storage section has deletion enabled:</p>
              <pre className="code-block">
{`storage:
  delete:
    enabled: true`}
              </pre>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fca5a5', fontSize: '0.85rem' }}>
                <Info size={16} />
                <span>Note: Remember to restart your docker container after updating the configurations.</span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" style={{ background: 'var(--primary)', color: 'white' }} onClick={() => setShowDeleteFixModal(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

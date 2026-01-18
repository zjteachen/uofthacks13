import { Identity } from '../types/identity';
import './IdentityMenu.css';

interface IdentityMenuProps {
  identities: Identity[];
  selectedId?: string;
  onSelectIdentity: (id: string) => void;
  onAddIdentity: () => void;
  onDeleteIdentity: (id: string) => void;
}

function IdentityMenu({
  identities,
  selectedId,
  onSelectIdentity,
  onAddIdentity,
  onDeleteIdentity
}: IdentityMenuProps) {
  return (
    <div className="identity-menu">
      <div className="menu-header">
        <div className="menu-title">
          <img src="/icons/icon.svg" alt="Janus" className="menu-icon" />
          <h2>Janus</h2>
        </div>
        <button className="add-btn" onClick={onAddIdentity} title="Add new identity">
          +
        </button>
      </div>

      <div className="identities-list">
        {identities.map((identity) => (
          <div
            key={identity.id}
            className={`identity-card ${selectedId === identity.id ? 'active' : ''}`}
            onClick={() => onSelectIdentity(identity.id)}
          >
            <img
              src={identity.profilePicture || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%23ccc"/%3E%3C/svg%3E'}
              alt={identity.name}
              className="profile-pic"
            />
            <div className="identity-info">
              <h3>{identity.name}</h3>
            </div>
            <button
              className="delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Delete "${identity.name}"?`)) {
                  onDeleteIdentity(identity.id);
                }
              }}
              title="Delete identity"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {identities.length === 0 && (
        <div className="empty-state">
          <p>No identities yet</p>
          <button onClick={onAddIdentity}>Create one</button>
        </div>
      )}
    </div>
  );
}

export default IdentityMenu;

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

const emptyUserForm = {
  name: "",
  email: "",
  password: "",
  role: "manager",
  jobberId: "",
  siteIds: []
};

const emptyJobberForm = {
  jobberName: "",
  oauthDomain: "",
  logoUrl: "",
  adminName: "",
  adminEmail: "",
  adminPassword: ""
};

function normalizeError(err) {
  return err?.message || "Request failed";
}

export function ManagementPage() {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [activePanel, setActivePanel] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [siteFilter, setSiteFilter] = useState("all");
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [jobberForm, setJobberForm] = useState(emptyJobberForm);

  async function loadOverview() {
    const data = await api.getManagementOverview();
    setOverview(data);
    return data;
  }

  useEffect(() => {
    loadOverview().catch((err) => setError(normalizeError(err)));
  }, []);

  const isSystemScope = overview?.scope === "system";
  const jobbers = overview?.jobbers || [];
  const activeJobber = overview?.jobber || jobbers[0] || null;

  useEffect(() => {
    if (!overview) return;
    setUserForm((form) => ({
      ...emptyUserForm,
      jobberId: form.jobberId || activeJobber?.id || ""
    }));
    if (!isSystemScope) {
      setSiteFilter(activeJobber?.id || "all");
    }
  }, [overview, activeJobber, isSystemScope]);

  const filteredSites = useMemo(() => {
    if (!overview) return [];
    if (!isSystemScope || siteFilter === "all") return overview.sites || [];
    return (overview.sites || []).filter((site) => site.jobberId === siteFilter);
  }, [overview, isSystemScope, siteFilter]);

  const filteredUsers = useMemo(() => {
    if (!overview) return [];
    if (!isSystemScope || siteFilter === "all") return overview.users || [];
    return (overview.users || []).filter((user) => user.jobberId === siteFilter);
  }, [overview, isSystemScope, siteFilter]);

  const selectedUser = useMemo(
    () => filteredUsers.find((user) => user.id === selectedUserId) || (overview?.users || []).find((user) => user.id === selectedUserId) || null,
    [filteredUsers, overview, selectedUserId]
  );

  const availableSitesForForm = useMemo(() => {
    if (!overview) return [];
    const targetJobberId = userForm.jobberId || activeJobber?.id || "";
    return (overview.sites || []).filter((site) => site.jobberId === targetJobberId);
  }, [overview, userForm.jobberId, activeJobber]);

  const roleCounts = useMemo(() => {
    const counts = { admin: 0, manager: 0 };
    for (const user of filteredUsers) {
      if (user.role === "admin") counts.admin += 1;
      if (user.role === "manager") counts.manager += 1;
    }
    return counts;
  }, [filteredUsers]);

  useEffect(() => {
    if (!selectedUser) return;
    setUserForm({
      name: selectedUser.name || "",
      email: selectedUser.email || "",
      password: "",
      role: selectedUser.role || "manager",
      jobberId: selectedUser.jobberId || activeJobber?.id || "",
      siteIds: selectedUser.siteIds || []
    });
    setActivePanel("edit-user");
  }, [selectedUser, activeJobber]);

  function resetStatus() {
    setError("");
    setMessage("");
  }

  function clearWorkspace() {
    setSelectedUserId("");
    setActivePanel("");
    setUserForm((form) => ({ ...emptyUserForm, jobberId: form.jobberId || activeJobber?.id || "" }));
    setJobberForm(emptyJobberForm);
  }

  function toggleSite(siteId) {
    setUserForm((form) => ({
      ...form,
      siteIds: form.siteIds.includes(siteId)
        ? form.siteIds.filter((id) => id !== siteId)
        : [...form.siteIds, siteId]
    }));
  }

  function toggleAllSites() {
    setUserForm((form) => {
      const siteIds = availableSitesForForm.map((site) => site.id);
      const allSelected = siteIds.length > 0 && siteIds.every((siteId) => form.siteIds.includes(siteId));
      return {
        ...form,
        siteIds: allSelected ? [] : siteIds
      };
    });
  }

  async function submitUserCreate(event) {
    event.preventDefault();
    resetStatus();
    setBusy(true);
    try {
      const payload = {
        name: userForm.name,
        email: userForm.email,
        password: userForm.password,
        role: userForm.role,
        jobberId: isSystemScope ? userForm.jobberId : activeJobber?.id,
        siteIds: userForm.role === "manager" ? userForm.siteIds : []
      };
      const data = await api.createManagedUser(payload);
      setOverview(data);
      clearWorkspace();
      setMessage("User created.");
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitUserEdit(event) {
    event.preventDefault();
    if (!selectedUser) return;
    resetStatus();
    setBusy(true);
    try {
      const payload = {
        name: userForm.name,
        email: userForm.email,
        role: userForm.role,
        jobberId: isSystemScope ? userForm.jobberId : selectedUser.jobberId,
        siteIds: userForm.role === "manager" ? userForm.siteIds : []
      };
      if (userForm.password.trim()) payload.password = userForm.password;
      const data = await api.updateManagedUser(selectedUser.id, payload);
      setOverview(data);
      clearWorkspace();
      setMessage("User updated.");
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser() {
    if (!selectedUser) return;
    if (!window.confirm(`Delete user ${selectedUser.email}?`)) return;

    resetStatus();
    setBusy(true);
    try {
      const data = await api.deleteManagedUser(selectedUser.id);
      setOverview(data);
      clearWorkspace();
      setMessage("User deleted.");
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitJobberCreate(event) {
    event.preventDefault();
    resetStatus();
    setBusy(true);
    try {
      const data = await api.createManagedJobber(jobberForm);
      setOverview(data);
      clearWorkspace();
      setMessage("Jobber created with initial admin user.");
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setBusy(false);
    }
  }

  if (error && !overview) return <div className="card">Management data failed to load: {error}</div>;
  if (!overview) return <div className="card">Loading management workspace...</div>;

  return (
    <div className="management-page">
      <section className="management-hero card">
        <div>
          <div className="section-header">
            <h3>Users</h3>
            <span>{isSystemScope ? "System scope" : activeJobber?.name}</span>
          </div>
          <p className="management-copy">
            {isSystemScope
              ? "System admin can see every site and user, then filter by jobber when needed."
              : "Jobber admins only manage users within their own jobber. Jobber names and logos are maintained in Admin > Branding."}
          </p>
        </div>
        <div className="management-stats">
          <div className="metric-card">
            <div className="metric-label">{isSystemScope ? "Jobbers" : "Visible Sites"}</div>
            <div className="metric-value">{isSystemScope ? jobbers.length : filteredSites.length}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Admins</div>
            <div className="metric-value">{roleCounts.admin}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Managers</div>
            <div className="metric-value">{roleCounts.manager}</div>
          </div>
        </div>
      </section>

      {message ? <div className="admin-banner admin-banner-success">{message}</div> : null}
      {error ? <div className="admin-banner admin-banner-error">{error}</div> : null}

      <section className="management-controls card">
        {isSystemScope ? (
          <>
            <div className="management-actions">
              <button type="button" onClick={() => { clearWorkspace(); setActivePanel("new-jobber"); }}>
                New Jobber
              </button>
            </div>
            <div className="management-filter">
              <span>Filter by jobber</span>
              <select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>
                <option value="all">All jobbers</option>
                {jobbers.map((jobber) => (
                  <option key={jobber.id} value={jobber.id}>{jobber.name}</option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <div className="queue-sub">Jobber admins only manage users within their own jobber.</div>
        )}
      </section>

      <section className="management-layout">
        <div className="card management-users-card">
          <div className="section-header">
            <h3>Users</h3>
            <span>{filteredUsers.length} visible</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                {isSystemScope ? <th>Jobber</th> : null}
                <th>Role</th>
                <th>Sites</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id}>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  {isSystemScope ? <td>{user.jobberName || "-"}</td> : null}
                  <td>{user.role}</td>
                  <td>{user.role === "manager" ? (user.siteIds?.length || 0) : "All"}</td>
                  <td>
                    <button type="button" onClick={() => setSelectedUserId(user.id)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="management-users-actions">
            <button type="button" onClick={() => { clearWorkspace(); setActivePanel("add-user"); }}>
              Add User
            </button>
          </div>
        </div>

        <div className="card management-work-card">
          {activePanel === "add-user" ? (
            <form className="stack" onSubmit={submitUserCreate}>
              <div className="section-header">
                <h3>Add User</h3>
                <span>Create an admin or manager</span>
              </div>
              {isSystemScope ? (
                <select
                  value={userForm.jobberId}
                  onChange={(event) => setUserForm((form) => ({ ...form, jobberId: event.target.value, siteIds: [] }))}
                >
                  {jobbers.map((jobber) => (
                    <option key={jobber.id} value={jobber.id}>{jobber.name}</option>
                  ))}
                </select>
              ) : null}
              <input placeholder="Full name" value={userForm.name} onChange={(event) => setUserForm((form) => ({ ...form, name: event.target.value }))} />
              <input placeholder="Email" value={userForm.email} onChange={(event) => setUserForm((form) => ({ ...form, email: event.target.value }))} />
              <input type="password" placeholder="Temporary password" value={userForm.password} onChange={(event) => setUserForm((form) => ({ ...form, password: event.target.value }))} />
              <select value={userForm.role} onChange={(event) => setUserForm((form) => ({ ...form, role: event.target.value, siteIds: event.target.value === "admin" ? [] : form.siteIds }))}>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
              {userForm.role === "manager" ? (
                <>
                  <div className="management-site-head">
                    <strong>Site access</strong>
                    <label className="management-site-selectall">
                      <input
                        type="checkbox"
                        checked={availableSitesForForm.length > 0 && availableSitesForForm.every((site) => userForm.siteIds.includes(site.id))}
                        onChange={toggleAllSites}
                      />
                      <span>Select all</span>
                    </label>
                  </div>
                  <div className="management-site-list">
                    {availableSitesForForm.map((site) => (
                      <label key={site.id} className="management-site-option">
                        <input
                          type="checkbox"
                          checked={userForm.siteIds.includes(site.id)}
                          onChange={() => toggleSite(site.id)}
                        />
                        <span>{site.siteCode} - {site.name}</span>
                      </label>
                    ))}
                  </div>
                  <div className="queue-sub">Managers only see the sites checked here. Default is no site access.</div>
                </>
              ) : (
                <div className="admin-empty-mini">Admins automatically see all sites for their jobber.</div>
              )}
              <div className="inline">
                <button type="submit" disabled={busy}>Create User</button>
                <button type="button" onClick={clearWorkspace}>Clear</button>
              </div>
            </form>
          ) : null}

          {activePanel === "edit-user" && selectedUser ? (
            <form className="stack" onSubmit={submitUserEdit}>
              <div className="section-header">
                <h3>Edit User</h3>
                <span>{selectedUser.email}</span>
              </div>
              {isSystemScope ? (
                <select
                  value={userForm.jobberId}
                  onChange={(event) => setUserForm((form) => ({ ...form, jobberId: event.target.value, siteIds: [] }))}
                >
                  {jobbers.map((jobber) => (
                    <option key={jobber.id} value={jobber.id}>{jobber.name}</option>
                  ))}
                </select>
              ) : null}
              <input placeholder="Full name" value={userForm.name} onChange={(event) => setUserForm((form) => ({ ...form, name: event.target.value }))} />
              <input placeholder="Email" value={userForm.email} onChange={(event) => setUserForm((form) => ({ ...form, email: event.target.value }))} />
              <input type="password" placeholder="New password (optional)" value={userForm.password} onChange={(event) => setUserForm((form) => ({ ...form, password: event.target.value }))} />
              <select value={userForm.role} onChange={(event) => setUserForm((form) => ({ ...form, role: event.target.value, siteIds: event.target.value === "admin" ? [] : form.siteIds }))}>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
              {userForm.role === "manager" ? (
                <>
                  <div className="management-site-head">
                    <strong>Site access</strong>
                    <label className="management-site-selectall">
                      <input
                        type="checkbox"
                        checked={availableSitesForForm.length > 0 && availableSitesForForm.every((site) => userForm.siteIds.includes(site.id))}
                        onChange={toggleAllSites}
                      />
                      <span>Select all</span>
                    </label>
                  </div>
                  <div className="management-site-list">
                    {availableSitesForForm.map((site) => (
                      <label key={site.id} className="management-site-option">
                        <input
                          type="checkbox"
                          checked={userForm.siteIds.includes(site.id)}
                          onChange={() => toggleSite(site.id)}
                        />
                        <span>{site.siteCode} - {site.name}</span>
                      </label>
                    ))}
                  </div>
                  <div className="queue-sub">Managers only see the sites checked here.</div>
                </>
              ) : (
                <div className="admin-empty-mini">Admins automatically see all sites for their jobber.</div>
              )}
              <div className="inline">
                <button type="submit" disabled={busy}>Save User</button>
                <button type="button" className="danger-btn" onClick={deleteUser} disabled={busy}>Delete User</button>
                <button type="button" onClick={clearWorkspace}>Clear</button>
              </div>
            </form>
          ) : null}

          {activePanel === "new-jobber" && isSystemScope ? (
            <form className="stack" onSubmit={submitJobberCreate}>
              <div className="section-header">
                <h3>New Jobber</h3>
                <span>Create a jobber and its initial admin</span>
              </div>
              <input placeholder="Jobber name" value={jobberForm.jobberName} onChange={(event) => setJobberForm((form) => ({ ...form, jobberName: event.target.value }))} />
              <input placeholder="OAuth domain (optional)" value={jobberForm.oauthDomain} onChange={(event) => setJobberForm((form) => ({ ...form, oauthDomain: event.target.value }))} />
              <input placeholder="Logo URL (optional)" value={jobberForm.logoUrl} onChange={(event) => setJobberForm((form) => ({ ...form, logoUrl: event.target.value }))} />
              <input placeholder="Admin name" value={jobberForm.adminName} onChange={(event) => setJobberForm((form) => ({ ...form, adminName: event.target.value }))} />
              <input placeholder="Admin email" value={jobberForm.adminEmail} onChange={(event) => setJobberForm((form) => ({ ...form, adminEmail: event.target.value }))} />
              <input type="password" placeholder="Admin password" value={jobberForm.adminPassword} onChange={(event) => setJobberForm((form) => ({ ...form, adminPassword: event.target.value }))} />
              <div className="inline">
                <button type="submit" disabled={busy}>Create Jobber</button>
                <button type="button" onClick={clearWorkspace}>Clear</button>
              </div>
            </form>
          ) : null}

          {!activePanel ? (
            <div className="admin-empty-state">
              Select `Add User`, `New Jobber`, or click `Edit` on a user to open the work area.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

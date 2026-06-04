import React, { useState, useEffect } from 'react';
import { Building2, Plus, Trash2, Edit2, Globe, Shield, Activity, RefreshCw } from 'lucide-react';

const BUTTON_PRIMARY = "flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black transition-all hover:scale-[1.02] hover:bg-cyan-300 disabled:opacity-50";
const BUTTON_SECONDARY = "flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-white/10 disabled:opacity-50";
const BUTTON_DANGER = "flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-2 text-sm font-medium text-rose-100 transition-all hover:bg-rose-500/10 disabled:opacity-50";

const API_URL = '/api';

export default function OrganizationManagement({ requestJson, showNotice }) {
  const [organizations, setOrganizations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState(null);
  const [formData, setFormData] = useState({ name: '', slug: '' });

  const fetchOrgs = async () => {
    setIsLoading(true);
    try {
      const data = await requestJson(`${API_URL}/organizations/`);
      setOrganizations(data || []);
    } catch (err) {
      showNotice('error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrgs();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingOrg) {
        await requestJson(`${API_URL}/organizations/${editingOrg.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        showNotice('success', 'Đã cập nhật tổ chức thành công.');
      } else {
        await requestJson(`${API_URL}/organizations/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        showNotice('success', 'Đã tạo tổ chức mới thành công.');
      }
      setIsModalOpen(false);
      setEditingOrg(null);
      setFormData({ name: '', slug: '' });
      fetchOrgs();
    } catch (err) {
      showNotice('error', err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa tổ chức này? Hành động này không thể hoàn tác.')) return;
    try {
      await requestJson(`${API_URL}/organizations/${id}`, { method: 'DELETE' });
      showNotice('success', 'Đã xóa tổ chức thành công.');
      fetchOrgs();
    } catch (err) {
      showNotice('error', err.message);
    }
  };

  const openEdit = (org) => {
    setEditingOrg(org);
    setFormData({ name: org.name, slug: org.slug });
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-cyan-400/10 p-3 text-cyan-400">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Quản lý Tổ chức</h2>
            <p className="text-sm text-[var(--text-soft)]">Quản lý các không gian làm việc đa khách hàng</p>
          </div>
        </div>
        <button onClick={() => { setEditingOrg(null); setFormData({ name: '', slug: '' }); setIsModalOpen(true); }} className={BUTTON_PRIMARY}>
          <Plus className="h-4 w-4" /> Tạo tổ chức mới
        </button>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-cyan-400" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {organizations.map((org) => (
            <div key={org.id} className="group relative overflow-hidden rounded-[28px] border border-white/5 bg-white/5 p-6 transition-all hover:border-white/10 hover:bg-white/[0.07]">
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black/20 text-white">
                  <Building2 className="h-6 w-6" />
                </div>
                <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => openEdit(org)} className="rounded-lg p-2 text-[var(--text-soft)] hover:bg-white/10 hover:text-white">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleDelete(org.id)} className="rounded-lg p-2 text-rose-400 hover:bg-rose-400/10 hover:text-rose-300">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-4">
                <h3 className="text-lg font-semibold text-white">{org.name}</h3>
                <div className="mt-1 flex items-center gap-2 text-sm text-[var(--text-soft)]">
                  <Globe className="h-3 w-3" />
                  <span>{org.slug}</span>
                </div>
                <div className="mt-4 flex items-center gap-4 border-t border-white/5 pt-4">
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-soft)]">
                    <Shield className="h-3 w-3" />
                    <span>Workspace Active</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[32px] border border-white/10 bg-[var(--panel-bg)] p-8 shadow-2xl">
            <h3 className="text-xl font-semibold text-white">{editingOrg ? 'Cập nhật tổ chức' : 'Tạo tổ chức mới'}</h3>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-soft)]">Tên tổ chức</label>
                <input
                  required
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white focus:border-cyan-400/50 focus:outline-none"
                  placeholder="VD: Agency Alpha"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-soft)]">Slug (URL)</label>
                <input
                  required
                  type="text"
                  value={formData.slug}
                  onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white focus:border-cyan-400/50 focus:outline-none"
                  placeholder="vd: agency-alpha"
                />
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">Chỉ dùng chữ thường, số và dấu gạch ngang.</p>
              </div>
              <div className="mt-8 flex gap-3">
                <button type="submit" className={BUTTON_PRIMARY + " flex-1 justify-center"}>
                  {editingOrg ? 'Lưu thay đổi' : 'Xác nhận tạo'}
                </button>
                <button type="button" onClick={() => setIsModalOpen(false)} className={BUTTON_SECONDARY + " flex-1 justify-center"}>
                  Hủy bỏ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

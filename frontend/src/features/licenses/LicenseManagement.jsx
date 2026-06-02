import React, { useState, useEffect } from 'react';
import { KeyRound, Plus, Ban, CheckCircle, Clock, Copy, RefreshCw } from 'lucide-react';

const BUTTON_PRIMARY = "flex items-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black transition-all hover:scale-[1.02] hover:bg-cyan-300 disabled:opacity-50";
const BUTTON_SECONDARY = "flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-white/10 disabled:opacity-50";
const BUTTON_DANGER = "flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-2 text-sm font-medium text-rose-100 transition-all hover:bg-rose-500/10 disabled:opacity-50";

const API_URL = '/api';

export default function LicenseManagement({ requestJson, showNotice }) {
  const [licenses, setLicenses] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({ days_total: '' });
  const [createdKey, setCreatedKey] = useState(null);

  const fetchLicenses = async () => {
    setIsLoading(true);
    try {
      const data = await requestJson(`${API_URL}/v1/automation/admin/license`);
      setLicenses(data || []);
    } catch (err) {
      showNotice('error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLicenses();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    const days = parseInt(formData.days_total, 10);
    if (!days || days <= 0) {
      showNotice('error', 'Số ngày phải là số nguyên dương.');
      return;
    }
    setIsCreating(true);
    try {
      const result = await requestJson(`${API_URL}/v1/automation/admin/license`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days_total: days }),
      });
      setCreatedKey(result.key);
      setFormData({ days_total: '' });
      await fetchLicenses();
    } catch (err) {
      showNotice('error', err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (id, key) => {
    if (!window.confirm(`Thu hồi license ${key}? License này sẽ bị vô hiệu hoá ngay lập tức và không thể phục hồi.`)) return;
    try {
      await requestJson(`${API_URL}/v1/automation/admin/license/${id}/revoke`, { method: 'POST' });
      showNotice('success', `Đã thu hồi license ${key}.`);
      await fetchLicenses();
    } catch (err) {
      showNotice('error', err.message);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      showNotice('success', 'Đã copy license key vào clipboard.');
    }).catch(() => {
      showNotice('error', 'Không thể copy. Hãy copy thủ công.');
    });
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <KeyRound className="h-5 w-5 text-cyan-300" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">License Keys</h2>
            <p className="text-sm text-white/50">Quản lý license cho người dùng automation desktop</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className={BUTTON_SECONDARY} onClick={fetchLicenses} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
          <button className={BUTTON_PRIMARY} onClick={() => { setIsModalOpen(true); setCreatedKey(null); }}>
            <Plus className="h-4 w-4" />
            Tạo key mới
          </button>
        </div>
      </div>

      {/* Create modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[var(--panel-bg,#0f172a)] p-6 shadow-2xl">
            <h3 className="mb-4 text-base font-semibold text-white">Tạo License Key Mới</h3>

            {createdKey ? (
              <div className="space-y-4">
                <p className="text-sm text-white/70">License key đã được tạo. Copy và gửi cho khách hàng:</p>
                <div className="flex items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3">
                  <code className="flex-1 select-all font-mono text-sm text-cyan-200">{createdKey}</code>
                  <button
                    className="shrink-0 rounded-xl bg-white/10 p-2 hover:bg-white/20"
                    onClick={() => copyToClipboard(createdKey)}
                    title="Copy key"
                  >
                    <Copy className="h-4 w-4 text-white" />
                  </button>
                </div>
                <div className="flex justify-end gap-2">
                  <button className={BUTTON_PRIMARY} onClick={() => { setCreatedKey(null); }}>
                    Tạo key khác
                  </button>
                  <button className={BUTTON_SECONDARY} onClick={() => { setIsModalOpen(false); setCreatedKey(null); }}>
                    Đóng
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-white/70">
                    Số ngày sử dụng <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="vd: 30, 90, 365"
                    value={formData.days_total}
                    onChange={(e) => setFormData({ days_total: e.target.value })}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    className={BUTTON_SECONDARY}
                    onClick={() => setIsModalOpen(false)}
                  >
                    Huỷ
                  </button>
                  <button type="submit" className={BUTTON_PRIMARY} disabled={isCreating}>
                    {isCreating ? 'Đang tạo...' : 'Tạo license'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* License table */}
      <div className="rounded-3xl border border-white/8 bg-white/3 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-white/40 text-sm">
            Đang tải danh sách license...
          </div>
        ) : licenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-white/40">
            <KeyRound className="h-8 w-8 opacity-40" />
            <p className="text-sm">Chưa có license key nào. Tạo key đầu tiên bằng nút bên trên.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 text-left text-xs font-medium text-white/40 uppercase tracking-wide">
                <th className="px-5 py-3.5">License Key</th>
                <th className="px-5 py-3.5">Số ngày</th>
                <th className="px-5 py-3.5">Trạng thái</th>
                <th className="px-5 py-3.5">Kích hoạt</th>
                <th className="px-5 py-3.5">Hết hạn</th>
                <th className="px-5 py-3.5">Ngày tạo</th>
                <th className="px-5 py-3.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {licenses.map((lic) => (
                <tr key={lic.id} className="group hover:bg-white/3 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-cyan-200 text-xs">{lic.key}</code>
                      <button
                        className="opacity-0 group-hover:opacity-100 rounded-lg p-1 hover:bg-white/10 transition-all"
                        onClick={() => copyToClipboard(lic.key)}
                        title="Copy key"
                      >
                        <Copy className="h-3.5 w-3.5 text-white/60" />
                      </button>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-white/70">{lic.days_total} ngày</td>
                  <td className="px-5 py-3.5">
                    {lic.revoked ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300">
                        <Ban className="h-3 w-3" /> Đã thu hồi
                      </span>
                    ) : lic.activated && lic.expires_at && new Date(lic.expires_at) < new Date() ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
                        <Clock className="h-3 w-3" /> Hết hạn
                      </span>
                    ) : lic.activated ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                        <CheckCircle className="h-3 w-3" /> Hoạt động
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/40">
                        Chưa kích hoạt
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-white/70">
                    {lic.activated ? 'Đã kích hoạt' : <span className="text-white/30">Chưa</span>}
                  </td>
                  <td className="px-5 py-3.5 text-white/70">{formatDate(lic.expires_at)}</td>
                  <td className="px-5 py-3.5 text-white/50">{formatDate(lic.created_at)}</td>
                  <td className="px-5 py-3.5 text-right">
                    {!lic.revoked && (
                      <button
                        className={BUTTON_DANGER + " text-xs px-3 py-1.5"}
                        onClick={() => handleRevoke(lic.id, lic.key)}
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Thu hồi
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

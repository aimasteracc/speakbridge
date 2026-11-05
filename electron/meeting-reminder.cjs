class MeetingReminder {
  constructor({ native, enabled, idle, notify }) { Object.assign(this, { native, enabled, idle, notify }); this.seen = new Map(); this.busy = false; }
  async poll() {
    if (this.busy || !this.enabled() || !this.idle()) return;
    this.busy = true;
    try {
      const result = await this.native.request('microphone-clients'); this.available = result.available === true; this.message = result.message || '';
      if (!this.available) return;
      const clients = (result.clients || []).filter(x => /zoom|teams|webex|slack|discord|chrome|safari|firefox|edge|腾讯会议|voov|lark|feishu/i.test(x.name + ' ' + x.bundle) && !/speakbridge/i.test(x.name + x.bundle));
      const active = new Set(clients.map(x => String(x.pid)));
      for (const [id, time] of this.seen) if (!active.has(id) && Date.now() - time > 300000) this.seen.delete(id);
      const fresh = clients.find(x => !this.seen.has(String(x.pid)));
      if (fresh) { clients.forEach(x => this.seen.set(String(x.pid), Date.now())); this.notify(String(fresh.name).slice(0, 80)); }
    } catch { this.available = false; this.message = '暂时无法读取应用麦克风状态。'; }
    finally { this.busy = false; }
  }
}
module.exports = { MeetingReminder };

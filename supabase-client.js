// =====================================================================
//  lib/supabase-client.js
//  Skupni odjemalec + pomožne funkcije (window.TutorDB).
//  Pred to datoteko naloži:
//    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//    <script src="/config.js"></script>
// =====================================================================
(function () {
  if (!window.supabase || !window.supabase.createClient) {
    console.error("Supabase knjižnica ni naložena (preveri <script> CDN).");
    return;
  }
  if (!window.SUPA_URL || !window.SUPA_KEY || window.SUPA_URL.includes("XXXX")) {
    alert("Nastavi svoje Supabase podatke v config.js!");
    return;
  }

  const sb = window.supabase.createClient(window.SUPA_URL, window.SUPA_KEY);
  window.sb = sb;

  async function uid() {
    const { data } = await sb.auth.getUser();
    return data.user ? data.user.id : null;
  }

  window.TutorDB = {
    sb,

    // ---------- AUTH ----------
    async currentUser() {
      const { data } = await sb.auth.getUser();
      return data.user;
    },
    async requireAuth(redirect = "/prijava.html") {
      const u = await this.currentUser();
      if (!u) { location.href = redirect; return null; }
      return u;
    },
    async register(email, username, password) {
      const { data, error } = await sb.auth.signUp({
        email, password, options: { data: { username } }
      });
      if (error) throw error;
      return data; // data.session je null, če je vklopljena email-potrditev
    },
    async login(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    async logout() {
      await sb.auth.signOut();
      location.href = "/prijava.html";
    },
    async profile() {
      const id = await uid();
      if (!id) return null;
      const { data } = await sb.from("profiles").select("*").eq("id", id).maybeSingle();
      return data;
    },

    // ---------- DOKUMENTI ----------
    async listDocuments() {
      const { data, error } = await sb.from("documents")
        .select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    async createDocument({ name, type, storage_path, num_questions }) {
      const id = await uid();
      const { data, error } = await sb.from("documents")
        .insert({ user_id: id, name, type, storage_path, num_questions: num_questions || 0 })
        .select().single();
      if (error) throw error;
      return data;
    },
    async getDocument(docId) {
      const { data, error } = await sb.from("documents").select("*").eq("id", docId).maybeSingle();
      if (error) throw error;
      return data;
    },
    async updateDocCount(docId, n) {
      await sb.from("documents").update({ num_questions: n }).eq("id", docId);
    },
    async deleteDocument(docId, storage_path) {
      if (storage_path) {
        try { await sb.storage.from("documents").remove([storage_path]); } catch (_) {}
      }
      const { error } = await sb.from("documents").delete().eq("id", docId);
      if (error) throw error;
    },

    // ---------- STORAGE ----------
    async uploadFile(file) {
      const id = await uid();
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${id}/${Date.now()}_${safe}`;
      const { error } = await sb.storage.from("documents").upload(path, file, { upsert: false });
      if (error) throw error;
      return path;
    },

    // ---------- VPRAŠANJA ----------
    async saveQuestions(documentId, pairs) {
      const id = await uid();
      const rows = pairs.map(p => ({
        document_id: documentId, user_id: id,
        topic: p.topic || "Splošno", question: p.question, reference: p.reference
      }));
      const { data, error } = await sb.from("questions").insert(rows).select();
      if (error) throw error;
      return data;
    },
    async loadQuestions(documentId) {
      const { data, error } = await sb.from("questions").select("*").eq("document_id", documentId);
      if (error) throw error;
      return data || [];
    },
    async allQuestions() {
      const { data, error } = await sb.from("questions").select("id,topic,document_id");
      if (error) throw error;
      return data || [];
    },

    // ---------- POSKUSI ----------
    async saveAttempt({ document_id, question_id, user_answer, score, feedback }) {
      const id = await uid();
      const { error } = await sb.from("attempts").insert({
        user_id: id, document_id, question_id, user_answer, score, feedback
      });
      if (error) throw error;
    },
    async loadAttempts(documentId) {
      const { data, error } = await sb.from("attempts")
        .select("*").eq("document_id", documentId).order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    async allAttempts() {
      const { data, error } = await sb.from("attempts")
        .select("question_id,document_id,score,created_at");
      if (error) throw error;
      return data || [];
    }
  };
})();

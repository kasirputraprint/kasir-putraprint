// ========================================================
// MODUL ANTIGRAVITY: UI KANBAN BOARD (DRAG & DROP)
// ========================================================

// 1. Toggling Views
window.switchOrderView = function(viewType) {
    const tableBtn = document.getElementById("btn-view-table");
    const kanbanBtn = document.getElementById("btn-view-kanban");
    const tableView = document.getElementById("order-view-table");
    const kanbanView = document.getElementById("order-view-kanban");

    if (!tableBtn || !kanbanBtn || !tableView || !kanbanView) return;

    if (viewType === 'table') {
        tableBtn.classList.add("active");
        kanbanBtn.classList.remove("active");
        tableView.style.display = "block";
        kanbanView.style.display = "none";
    } else {
        kanbanBtn.classList.add("active");
        tableBtn.classList.remove("active");
        kanbanView.style.display = "block";
        tableView.style.display = "none";
    }
};

// 2. Rendering Kanban Cards
window.renderKanbanBoard = function(dataOrder) {
    const colPending = document.getElementById("kanban-pending");
    const colProses = document.getElementById("kanban-proses");
    const colSelesai = document.getElementById("kanban-selesai");

    if (!colPending || !colProses || !colSelesai) return;

    // Reset columns
    colPending.innerHTML = "";
    colProses.innerHTML = "";
    colSelesai.innerHTML = "";

    let countPending = 0;
    let countProses = 0;
    let countSelesai = 0;

    dataOrder.forEach(o => {
        let statusDisplay = (o.status || "").toUpperCase();
        if (statusDisplay === "DESAIN" || statusDisplay === "CETAK" || statusDisplay === "FINISHING") {
            statusDisplay = "PROSES";
        }

        // Hitung sisa tagihan
        let isLunas = o.sisaTagihan <= 0;
        let badgeBayar = isLunas 
            ? `<span class="badge bg-success" style="font-size:0.6rem;">LUNAS</span>` 
            : `<span class="badge bg-danger" style="font-size:0.6rem;">BELUM LUNAS</span>`;

        let cardHtml = `
            <div class="card mb-2 shadow-sm border-0" draggable="true" ondragstart="dragKanban(event, '${o.notaId}')" style="cursor:grab;">
                <div class="card-body p-2">
                    <div class="d-flex justify-content-between mb-1">
                        <strong style="font-size:0.8rem; color:var(--text-primary);">#${o.notaId}</strong>
                        ${badgeBayar}
                    </div>
                    <div style="font-size:0.8rem;" class="fw-bold text-truncate">${o.nama}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);" class="mb-2">${o.tanggal}</div>
                    <div class="d-flex justify-content-between align-items-center">
                        <span style="font-size:0.75rem; color:var(--text-primary); font-weight:600;">Rp ${o.totalBelanja.toLocaleString('id-ID')}</span>
                        <button class="btn btn-sm btn-light border p-1" style="font-size:0.65rem;" onclick="window.bukaPopupDetailOrder('${o.notaId}')"><i class="fa-solid fa-eye"></i> Detail</button>
                    </div>
                </div>
            </div>
        `;

        if (statusDisplay === "PENDING") {
            colPending.innerHTML += cardHtml;
            countPending++;
        } else if (statusDisplay === "PROSES") {
            colProses.innerHTML += cardHtml;
            countProses++;
        } else if (statusDisplay === "SELESAI") {
            colSelesai.innerHTML += cardHtml;
            countSelesai++;
        }
    });

    document.getElementById("kanban-count-pending").innerText = countPending;
    document.getElementById("kanban-count-proses").innerText = countProses;
    document.getElementById("kanban-count-selesai").innerText = countSelesai;
};

// 3. HTML5 Drag and Drop Handlers
window.dragKanban = function(ev, notaId) {
    ev.dataTransfer.setData("text", notaId);
    ev.target.style.opacity = "0.4";
};

document.addEventListener("dragend", function(ev) {
    if (ev.target.draggable) {
        ev.target.style.opacity = "1";
    }
});

window.allowDrop = function(ev) {
    ev.preventDefault(); // Diperlukan agar elemen bisa di-drop
};

window.dropKanban = function(ev, targetStatus) {
    ev.preventDefault();
    let notaId = ev.dataTransfer.getData("text");
    if (!notaId) return;

    // Panggil fungsi Firebase global yang sudah ada di script.js
    if (window.gantiStatusWorkflow) {
        window.gantiStatusWorkflow(notaId, targetStatus);
        
        // Mainkan efek suara atau notifikasi kecil
        if (window.showNotification) {
            window.showNotification(`Order #${notaId} digeser ke ${targetStatus}`, "success");
        }
    }
};

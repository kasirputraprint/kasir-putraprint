const fs = require('fs');

let code = fs.readFileSync('script.js', 'utf8');

// 1. Refactor Globals to Window
const globals = [
    'keranjang', 'editIndex', 'listProduk', 'currentSortField', 'currentSortDirection', 
    'currentProdukSort', 'currentProdukDirection', 'produkTerpilih', 'kategoriAktif', 
    'kataKunciProduk', 'masterOrdersCache', 'databasePelangganLokal', 'kebijakanSistemLokal',
    'targetTabTerkunci', 'targetElemenMenu'
];

globals.forEach(g => {
    // Ubah deklarasi "let keranjang = ..." menjadi "window.keranjang = ..."
    code = code.replace(new RegExp(`let\\s+${g}\\s*=`, 'g'), `window.${g} =`);
    
    // Ubah semua pemanggilan "keranjang" menjadi "window.keranjang"
    // Gunakan regex boundary \b agar tidak salah replace misal "my_keranjang"
    // Gunakan negative lookbehind/lookahead untuk menghindari property access spt "obj.keranjang"
    const regex = new RegExp(`(?<![\\.\\w])\\b${g}\\b(?!\\s*:)`, 'g');
    code = code.replace(regex, `window.${g}`);
});

// Write to js/globals.js
const globalsFile = `
// ========================================================
// 1. MODUL: GLOBALS (STATE MANAGEMENT)
// ========================================================
${globals.map(g => `window.${g} = typeof window.${g} !== 'undefined' ? window.${g} : null;`).join('\n')}

window.keranjang = [];
window.listProduk = [];
window.masterOrdersCache = {};
window.databasePelangganLokal = {};
window.kebijakanSistemLokal = { tarifPotong: 125, metodePembulatan: 500, hariVakum: 14, minOrderLoyal: 5 };
window.editIndex = -1;
window.currentSortField = null;
window.currentSortDirection = "asc";
window.currentProdukSort = null;
window.currentProdukDirection = "asc";
window.produkTerpilih = null;
window.kategoriAktif = "SEMUA";
window.kataKunciProduk = "";
window.targetTabTerkunci = "";
window.targetElemenMenu = null;
`;
fs.writeFileSync('js/globals.js', globalsFile);

// Hapus deklarasi awal dari code
code = code.replace(/window\.keranjang = \[\];[\s\S]*?let listProduk = \[\];/, '');
code = code.replace(/window\.currentSortField = null;[\s\S]*?window\.databasePelangganLokal = \{\};/, '');

// Tambahkan impor yang diperlukan ke file-file
const firebaseImports = `import { ref, set, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { db } from "./firebase-init.js";
`;

// Extract Cart Engine (Kasar, kita simpan sisa file di main.js untuk sementara)
// Karena script.js terlalu kompleks, sisa code disimpan di main.js
fs.writeFileSync('js/main.js', firebaseImports + '\n' + code);

console.log("Globals refactored and main.js generated.");

const axios = require('axios');
const API_BASE = "http://localhost:5000/api";

async function test() {
    try {
        const res = await axios.get(`${API_BASE}/inventaire/getAllInventaires`);
        const data = res.data.data;
        console.log(`Fetched ${data.length} inventaires`);
        data.forEach(inv => {
            console.log(`Inv ${inv.numero}: article_count=${inv.article_count}, items.length=${inv.items ? inv.items.length : 'NULL'}`);
        });
    } catch (e) {
        console.error(e.message);
    }
}
test();

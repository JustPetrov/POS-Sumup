/**
 * Plugin Name: Bendemen SumUp Terminal Service
 * Description: Standalone SumUp Reader microservice add-on voor Bendemen POS met Pairing, Checkout, Unlink, Readers ophalen en per-locatie koppeling.
 * Author: Bendemen
 * License: GNU General Public License v3.0 (GPLv3)
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3001;
const SUMUP_API_KEY = process.env.SUMUP_API_KEY;
const MERCHANT_CODE = process.env.SUMUP_MERCHANT_CODE;
const DEFAULT_READER_ID = process.env.SUMUP_READER_ID;

// MySQL Database Pool voor locatie-koppelingen
const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'bendemen_pos'
});

const sumupAxios = axios.create({
  baseURL: 'https://api.sumup.com/v0.1',
  headers: {
    'Authorization': `Bearer ${SUMUP_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

// 1. READERS OPVRAGEN (Alle gekoppelde pinautomaten ophalen)
app.get('/api/terminal/readers', async (req, res) => {
  try {
    const response = await sumupAxios.get(`/merchants/${MERCHANT_CODE}/readers`);
    const readers = response.data.items || response.data;
    return res.json({ success: true, readers });
  } catch (error) {
    console.error('List Readers Error:', error.response?.data || error.message);
    return res.status(400).json({ success: false, error: 'Kan readers niet ophalen bij SumUp.' });
  }
});

// 2. PAIRING (Koppelen van een nieuwe terminal via pairing code)
app.post('/api/terminal/pair', async (req, res) => {
  const { pairingCode, name } = req.body;

  if (!pairingCode) {
    return res.status(400).json({ success: false, error: 'Pairing code ontbreekt.' });
  }

  try {
    const response = await sumupAxios.post(`/merchants/${MERCHANT_CODE}/readers`, {
      pairing_code: pairingCode.trim(),
      name: name || 'Bendemen POS Terminal'
    });

    return res.json({
      success: true,
      data: response.data,
      message: 'Terminal succesvol gekoppeld (gepaard)!'
    });
  } catch (error) {
    console.error('Pairing Error:', error.response?.data || error.message);
    return res.status(400).json({
      success: false,
      error: error.response?.data?.message || 'Fout bij koppelen van de terminal.'
    });
  }
});

// 3. UNLINK (Ontkoppelen van een terminal op basis van reader_id)
app.delete('/api/terminal/unlink/:readerId', async (req, res) => {
  const { readerId } = req.params;

  if (!readerId) {
    return res.status(400).json({ success: false, error: 'Reader ID ontbreekt.' });
  }

  try {
    await sumupAxios.delete(`/merchants/${MERCHANT_CODE}/readers/${readerId}`);
    return res.json({
      success: true,
      message: `Terminal ${readerId} succesvol ontkoppeld!`
    });
  } catch (error) {
    console.error('Unlink Error:', error.response?.data || error.message);
    return res.status(400).json({
      success: false,
      error: error.response?.data?.message || 'Fout bij ontkoppelen van de terminal.'
    });
  }
});

// 4. LOCATIE KOPPELING (Koppel een reader_id aan een storeId in de database)
app.post('/api/terminal/assign-store', async (req, res) => {
  const { storeId, readerId } = req.body;

  if (!storeId || !readerId) {
    return res.status(400).json({ success: false, error: 'Store ID en Reader ID zijn verplicht.' });
  }

  try {
    await db.query(
      'UPDATE stores SET terminal_id = ? WHERE id = ? OR store_id = ?',
      [readerId.trim(), storeId, storeId]
    );

    return res.json({
      success: true,
      message: `Pinautomaat ${readerId} succesvol gekoppeld aan filiaal ${storeId}!`
    });
  } catch (error) {
    console.error('Assign Store Error:', error.message);
    return res.status(400).json({ success: false, error: 'Fout bij opslaan in database.' });
  }
});

// 5. AFREKENEN (Betaalverzoek sturen naar de terminal op basis van storeId)
app.post('/api/terminal/pay', async (req, res) => {
  const { totalAmount, storeId } = req.body;

  if (!totalAmount || isNaN(totalAmount) || totalAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Ongeldig of ontbrekend bedrag.' });
  }

  try {
    let targetReaderId = null;

    // Zoek de terminal_id op basis van het filiaal in de database
    if (storeId) {
      const [rows] = await db.query(
        'SELECT terminal_id FROM stores WHERE id = ? OR store_id = ? LIMIT 1',
        [storeId, storeId]
      );
      if (rows && rows.length > 0) {
        targetReaderId = rows[0].terminal_id;
      }
    }

    // Fallback naar .env als er geen specifieke terminal is gevonden voor deze locatie
    if (!targetReaderId) {
      targetReaderId = DEFAULT_READER_ID;
    }

    if (!targetReaderId) {
      return res.status(400).json({ success: false, error: 'Geen actieve Terminal ID gevonden voor deze locatie.' });
    }

    const sumupRes = await sumupAxios.post('/checkouts', {
      amount: parseFloat(totalAmount),
      currency: 'EUR',
      payment_type: 'reader',
      reader_id: targetReaderId.trim(),
      merchant_code: MERCHANT_CODE.trim(),
      checkout_reference: `BDM-LOC-${storeId || 'GEN'}-${Date.now()}`
    });

    return res.json({
      success: true,
      transactionId: sumupRes.data.id,
      status: sumupRes.data.status,
      readerId: targetReaderId.trim(), // Handig om direct mee te sturen voor de printer
      message: 'Betaalverzoek verzonden naar de pinautomaat!'
    });

  } catch (error) {
    const errorMsg = error.response?.data?.message || error.response?.data?.detail || error.message;
    console.error('SumUp Pay Error:', error.response?.data || error.message);
    return res.status(400).json({
      success: false,
      error: `SumUp weigert betaling: ${errorMsg}`
    });
  }
});

// 6. SUMUP SOLO PRINTER ENDPOINT (Specifiek ontworpen voor de ingebouwde printer)
app.post('/api/terminal/print-solo', async (req, res) => {
  const { readerId, order, store } = req.body;

  if (!readerId || !order) {
    return res.status(400).json({ success: false, error: 'Reader ID en ordergegevens zijn vereist.' });
  }

  const storeName = store?.store_name || store?.name || 'BENDEMEN';
  const storeKvk = store?.kvk || '82882851';

  // Strak opgemaakte string specifiek voor het smalle papier van de SumUp Solo
  const receiptText = `
${storeName.toUpperCase()}
KVK: ${storeKvk}
--------------------------------
Order: #${order.id || 'POS'}
Datum: ${new Date().toLocaleString('nl-NL')}
--------------------------------
${(order.orderItems || []).map(i => `${i.name.padEnd(16)} x${i.quantity} \n  €${(parseFloat(i.price) * i.quantity).toFixed(2)}`).join('\n')}
--------------------------------
TOTAAL:      €${parseFloat(order.totals?.totalPaid || 0).toFixed(2)}
--------------------------------
Bedankt voor je aankoop!
www.bendemen.nl
  `.trim();

  try {
    await sumupAxios.post(`/merchants/${MERCHANT_CODE}/readers/${readerId}/print`, {
      text: receiptText
    });

    return res.json({ success: true, message: 'Bon succesvol verzonden naar de SumUp Solo printer!' });
  } catch (error) {
    console.error('Solo Print Error:', error.response?.data || error.message);
    return res.status(400).json({ success: false, error: 'Kon niet printen op de SumUp Solo.' });
  }
});

app.listen(PORT, () => {
  console.log(`Bendemen SumUp Add-on service draait op poort ${PORT}[cite: 1]`);
});
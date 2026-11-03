/**
 * server/rede.js
 * Detecção de interfaces de rede IPv4, geração de PIN e QR Code.
 * Suporta alteração dinâmica de PIN com persistência em config.json,
 * validação de 4 a 8 dígitos e verificação de origem local (notebook).
 */

import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARQUIVO_CONFIG = path.resolve(__dirname, '..', 'config.json');

/**
 * Obtém a lista de endereços IPv4 da máquina e identifica o IP preferido (Hotspot).
 * @returns {Object} { ipPreferido, todasInterfaces }
 */
export function detectarEnderecosRede() {
  const interfaces = os.networkInterfaces();
  const listaIps = [];
  let ipPreferido = null;

  for (const [nome, ifaceList] of Object.entries(interfaces)) {
    for (const iface of ifaceList) {
      if (iface.family === 'IPv4' && !iface.internal) {
        listaIps.push({
          interface: nome,
          ip: iface.address
        });
        // Windows Hotspot usa por padrão 192.168.137.1
        if (iface.address === '192.168.137.1') {
          ipPreferido = iface.address;
        }
      }
    }
  }

  // Se não encontrou o IP exato do hotspot, usa o primeiro IP não-interno disponível
  if (!ipPreferido && listaIps.length > 0) {
    ipPreferido = listaIps[0].ip;
  }

  if (!ipPreferido) {
    ipPreferido = '127.0.0.1';
  }

  return {
    ipPreferido,
    todasInterfaces: listaIps
  };
}

/**
 * Verifica se uma requisição HTTP ou conexão provém do próprio notebook (origem local).
 * @param {Object} req - Objeto de requisição http ou similar com socket.remoteAddress.
 * @returns {boolean}
 */
export function ehOrigemLocal(req) {
  let ip = req?.socket?.remoteAddress || req?.ip || req?.connection?.remoteAddress || '';
  if (!ip) return false;

  // Normaliza representação IPv6 mapeada para IPv4 (ex: ::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }

  // Loopback padrão
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    return true;
  }

  // Endereços de interfaces locais da máquina
  const { todasInterfaces } = detectarEnderecosRede();
  if (todasInterfaces.some(i => i.ip === ip)) {
    return true;
  }

  return false;
}

/**
 * Obtém o status do PIN e sua procedência.
 * @returns {Object} { pin, fixoPorParametro, origem }
 */
export function obterStatusPin() {
  const args = process.argv.slice(2);
  const pinIdx = args.indexOf('--pin');
  if (pinIdx !== -1 && args[pinIdx + 1]) {
    const pinCustom = String(args[pinIdx + 1]).trim();
    if (/^\d{4,8}$/.test(pinCustom)) {
      return { pin: pinCustom, fixoPorParametro: true, origem: 'cli' };
    }
  }

  if (process.env.FILA_PIN && /^\d{4,8}$/.test(process.env.FILA_PIN.trim())) {
    return { pin: process.env.FILA_PIN.trim(), fixoPorParametro: true, origem: 'env' };
  }

  try {
    if (fs.existsSync(ARQUIVO_CONFIG)) {
      const cfg = JSON.parse(fs.readFileSync(ARQUIVO_CONFIG, 'utf-8'));
      if (cfg && cfg.pin && /^\d{4,8}$/.test(String(cfg.pin).trim())) {
        return { pin: String(cfg.pin).trim(), fixoPorParametro: false, origem: 'config' };
      }
    }
  } catch (e) {
    console.warn('[REDE] Erro ao ler config.json:', e);
  }

  return { pin: '1234', fixoPorParametro: false, origem: 'padrao' };
}

/**
 * Obtém o PIN numérico (4 a 8 dígitos).
 * @returns {string} PIN
 */
export function obterOuGerarPin() {
  return obterStatusPin().pin;
}

/**
 * Grava o novo PIN no arquivo config.json.
 * @param {string} novoPin - PIN numérico de 4 a 8 dígitos.
 * @returns {boolean}
 */
export function salvarPinConfig(novoPin) {
  const pinStr = String(novoPin).trim();
  if (!/^\d{4,8}$/.test(pinStr)) {
    throw new Error('O PIN deve ser numérico e conter de 4 a 8 dígitos.');
  }

  let cfg = {};
  try {
    if (fs.existsSync(ARQUIVO_CONFIG)) {
      cfg = JSON.parse(fs.readFileSync(ARQUIVO_CONFIG, 'utf-8'));
    }
  } catch (e) {
    cfg = {};
  }

  cfg.pin = pinStr;
  fs.writeFileSync(ARQUIVO_CONFIG, JSON.stringify(cfg, null, 2), 'utf-8');
  return true;
}

/**
 * Gera representações de QR Code (ASCII para o terminal e DataURL para o painel web).
 * @param {string} url - URL para conexão dos celulares.
 * @returns {Promise<Object>} { qrTerminal, qrDataUrl }
 */
export async function gerarQrCode(url) {
  try {
    const qrTerminal = await qrcode.toString(url, { type: 'terminal', small: true });
    const qrDataUrl = await qrcode.toDataURL(url, { width: 280, margin: 2 });
    return { qrTerminal, qrDataUrl };
  } catch (err) {
    console.error('Erro ao gerar QR code:', err);
    return { qrTerminal: '', qrDataUrl: '' };
  }
}

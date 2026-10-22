/**
 * server/rede.js
 * Detecção de interfaces de rede IPv4, geração de PIN e QR Code.
 */

import os from 'os';
import qrcode from 'qrcode';

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
 * Gera ou obtém o PIN de 4 dígitos da linha de comando (--pin XXXX).
 * @returns {string} PIN de 4 dígitos
 */
export function obterOuGerarPin() {
  const args = process.argv.slice(2);
  const pinIdx = args.indexOf('--pin');
  if (pinIdx !== -1 && args[pinIdx + 1]) {
    const pinCustom = String(args[pinIdx + 1]).trim();
    if (/^\d{4}$/.test(pinCustom)) {
      return pinCustom;
    }
  }
  // Gera PIN aleatório de 4 dígitos entre 1000 e 9999
  const pinAleatorio = Math.floor(1000 + Math.random() * 9000);
  return String(pinAleatorio);
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


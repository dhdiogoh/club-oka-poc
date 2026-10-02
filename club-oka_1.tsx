/**
 * Club OKA — Protótipo frontend (demo clicável, sem backend)
 *
 * Arquivo único organizado em seções para virar projeto Vite depois:
 *   1. Tipos
 *   2. Constantes e regras padrão
 *   3. Utilitários puros (telefone, dinheiro, datas, pontos, cupons)
 *   4. Dados fictícios (seed)
 *   5. Estado global (reducer + context)
 *   6. Estilos
 *   7. Componentes compartilhados
 *   8. Telas do cliente (C1–C5)
 *   9. Telas do atendente (A1–A2)
 *  10. Telas do dono (D1–D4)
 *  11. App (seletor de visão)
 *
 * Como rodar / publicar na Vercel:
 *   npm create vite@latest club-oka -- --template react-ts
 *   cd club-oka && npm install
 *   copie este arquivo para src/App.tsx (pode apagar App.css e index.css,
 *   e a linha `import './index.css'` do main.tsx)
 *   npm run dev            → testar local
 *   suba no GitHub e importe na Vercel (preset "Vite", sem configuração extra)
 *
 * Única dependência: React. Estado só em memória: recarregar volta ao início.
 */
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Dispatch, ReactNode } from "react";

/* ============================================================
 * 1. TIPOS
 * ============================================================ */

export type Cliente = {
  id: string;
  nome: string;
  telefone: string; // só dígitos, com DDD: "91999990001"
  email: string;
  criadoEm: string; // ISO
};

export type CategoriaPremio = "cafe-gelado" | "cafe" | "salgado" | "doce" | "combo";

export type Premio = {
  id: string;
  nome: string;
  descricao?: string;
  categoria: CategoriaPremio; // define o ícone do card
  pontos: number;
  ativo: boolean;
};

export type TipoMovimento = "compra" | "resgate" | "ajuste" | "estorno";

export type Movimento = {
  id: string;
  clienteId: string;
  tipo: TipoMovimento;
  pontos: number; // com sinal: +48 numa compra, -400 num resgate
  data: string; // ISO
  valorCompra?: number; // só em "compra"
  cupomId?: string; // em "resgate"
  descricao: string;
};

export type Cupom = {
  id: string;
  codigo: string; // "OKA-7K3P"
  clienteId: string;
  premioId: string;
  premioNome: string; // cópia no momento do resgate
  pontosDebitados: number; // cópia no momento do resgate
  criadoEm: string;
  expiraEm: string;
  usadoEm?: string;
};

export type StatusCupom = "ativo" | "usado" | "expirado";

export type Regras = {
  pontosPorReal: number; // multiplicador (1 = 1 ponto por R$ 1)
  validadeCupomDias: number; // 7 a 15
  limiteConfirmacaoExtra: number; // R$ acima do qual pede confirmação extra
};

export type AppState = {
  clientes: Cliente[];
  premios: Premio[];
  movimentos: Movimento[];
  cupons: Cupom[];
  regras: Regras;
};

/* ============================================================
 * 2. CONSTANTES E REGRAS PADRÃO
 * ============================================================ */

export const REGRAS_PADRAO: Regras = {
  pontosPorReal: 1,
  validadeCupomDias: 10,
  limiteConfirmacaoExtra: 500,
};

export const VALIDADE_MIN = 7;
export const VALIDADE_MAX = 15;

/** Marcos da régua de progresso da tela C2. */
export const MARCOS = [250, 500, 750, 1000] as const;

/** Faixas da vitrine (abas da tela C3). */
export const FAIXAS = [
  { id: "ate250", rotulo: "Até 250", min: 0, max: 250 },
  { id: "251a500", rotulo: "251–500", min: 251, max: 500 },
  { id: "501a750", rotulo: "501–750", min: 501, max: 750 },
  { id: "751mais", rotulo: "751+", min: 751, max: Infinity },
] as const;

export type FaixaId = (typeof FAIXAS)[number]["id"];

/** Regra de arredondamento: fração de ponto ≥ 0,90 sobe; abaixo disso, descarta. */
export const LIMIAR_ARREDONDAMENTO = 0.9;

/** Alfabeto do código do cupom, sem caracteres ambíguos (0/O, 1/I/L). */
const ALFABETO_CUPOM = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/* ============================================================
 * 3. UTILITÁRIOS PUROS
 * ============================================================ */

/* ---------- Telefone ---------- */

/**
 * Normaliza para só dígitos com DDD. Aceita "(91) 98888-7777",
 * "91988887777" e "+55 91 98888-7777". Retorna null se inválido.
 */
export function normalizarTelefone(entrada: string): string | null {
  let d = entrada.replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (d[0] === "0" || d[1] === "0") return null; // DDD válido é 11–99
  if (d.length === 11 && d[2] !== "9") return null; // celular começa com 9
  return d;
}

export function formatarTelefone(digitos: string): string {
  if (digitos.length === 11) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  if (digitos.length === 10) return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  return digitos;
}

/* ---------- Texto ---------- */

/** Minúsculas e sem acento, para busca: "João" casa com "joao". */
export function normalizarTexto(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/* ---------- Dinheiro ---------- */

/**
 * Converte o que o atendente digitou em reais. Aceita "47,90", "47.90",
 * "1.000,50", "R$ 50". Retorna null se não for um número válido.
 * Regra para ponto sem vírgula: "1.000" (3 dígitos após o ponto) é milhar;
 * "47.9" ou "47.90" é decimal.
 */
export function parseValor(entrada: string): number | null {
  let s = entrada.replace(/R\$/gi, "").replace(/\s/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const fmtMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const formatarMoeda = (v: number) => fmtMoeda.format(v);

const fmtNumero = new Intl.NumberFormat("pt-BR");
export const formatarPontos = (p: number) => fmtNumero.format(p);

/* ---------- Datas ---------- */

const DIA_MS = 24 * 60 * 60 * 1000;

/** Data relativa a hoje, para os dados fictícios parecerem recentes na demo. */
export function diasAtras(dias: number, hora = 10, minuto = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  d.setHours(hora, minuto, 0, 0);
  return d.toISOString();
}

/** Fim do dia (23:59:59) de `inicio + dias`: o cupom vale o dia inteiro do vencimento. */
export function calcularExpiracao(inicioISO: string, dias: number): string {
  const d = new Date(inicioISO);
  d.setDate(d.getDate() + dias);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

export function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function diasRestantes(expiraISO: string, agora = new Date()): number {
  return Math.max(0, Math.ceil((new Date(expiraISO).getTime() - agora.getTime()) / DIA_MS));
}

/* ---------- Pontos ---------- */

/**
 * Pontos de uma compra. Trabalha em centésimos para evitar erro de ponto
 * flutuante (47,90 × 1 nunca vira 47,8999…). Fração ≥ 0,90 arredonda pra cima.
 *   R$ 47,90 → 47,90 pts → 48   |   R$ 47,80 → 47   |   R$ 0,50 → 0
 */
export function calcularPontos(valor: number, regras: Regras): number {
  if (!(valor > 0) || !(regras.pontosPorReal > 0)) return 0;
  const centesimos = Math.round(valor * 100 * regras.pontosPorReal);
  const inteiro = Math.floor(centesimos / 100);
  const fracao = (centesimos % 100) / 100;
  return fracao >= LIMIAR_ARREDONDAMENTO ? inteiro + 1 : inteiro;
}

/** Saldo = soma dos movimentos. Nunca é guardado como número solto. */
export function saldo(clienteId: string, movimentos: Movimento[]): number {
  return movimentos.reduce((s, m) => (m.clienteId === clienteId ? s + m.pontos : s), 0);
}

export function movimentosDoCliente(clienteId: string, movimentos: Movimento[]): Movimento[] {
  return movimentos
    .filter((m) => m.clienteId === clienteId)
    .sort((a, b) => b.data.localeCompare(a.data));
}

export function faixaDe(pontos: number): FaixaId {
  return (FAIXAS.find((f) => pontos >= f.min && pontos <= f.max) ?? FAIXAS[FAIXAS.length - 1]).id;
}

/* ---------- Cupons ---------- */

export function statusCupom(c: Cupom, agora = new Date()): StatusCupom {
  if (c.usadoEm) return "usado";
  if (agora.getTime() > new Date(c.expiraEm).getTime()) return "expirado";
  return "ativo";
}

/** "oka 7k3p", "OKA-7K3P" e "7k3p" viram todos "OKA-7K3P". */
export function normalizarCodigo(entrada: string): string {
  let s = entrada.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("OKA")) s = s.slice(3);
  return s ? `OKA-${s}` : "";
}

export function gerarCodigoCupom(existentes: Set<string>): string {
  for (;;) {
    let s = "";
    for (let i = 0; i < 4; i++) s += ALFABETO_CUPOM[Math.floor(Math.random() * ALFABETO_CUPOM.length)];
    const codigo = `OKA-${s}`;
    if (!existentes.has(codigo)) return codigo;
  }
}

/* ---------- IDs ---------- */

let contadorId = 0;
/** IDs únicos na sessão. Em produção, viriam do backend. */
export function novoId(prefixo: string): string {
  contadorId += 1;
  return `${prefixo}_${Date.now().toString(36)}_${contadorId}`;
}

/* ============================================================
 * 4. DADOS FICTÍCIOS (SEED)
 * ============================================================
 * Prêmios: café gelado em ~400 pts (R$ 21) → fator ≈ 19 pts por R$ de preço.
 * Combos têm leve desconto em pontos, para incentivar o resgate maior.
 */

export const PREMIOS_INICIAIS: Premio[] = [
  { id: "p_bolo", nome: "Bolo Aconchego", descricao: "Fatia do bolo da casa", categoria: "doce", pontos: 220, ativo: true },
  { id: "p_cappuccino", nome: "Cappuccino Oka", categoria: "cafe", pontos: 250, ativo: true },
  { id: "p_paoqueijo", nome: "Porção de pão de queijo", descricao: "Com ricota ou doce de leite", categoria: "salgado", pontos: 380, ativo: true },
  { id: "p_sanduiche", nome: "Sanduíche Natural", categoria: "salgado", pontos: 380, ativo: true },
  { id: "p_tonica", nome: "Tônica Oka", descricao: "Café gelado", categoria: "cafe-gelado", pontos: 400, ativo: true },
  { id: "p_primavera", nome: "Primavera", descricao: "Café gelado", categoria: "cafe-gelado", pontos: 400, ativo: true },
  { id: "p_ciabatta", nome: "Ciabatta com salame", descricao: "Salame e queijo do Marajó", categoria: "salgado", pontos: 480, ativo: true },
  { id: "p_croissant", nome: "Croissant com frango e ricota", categoria: "salgado", pontos: 480, ativo: true },
  { id: "p_combo_tarde", nome: "Combo Café da Tarde", descricao: "Cappuccino Oka + Bolo Aconchego", categoria: "combo", pontos: 520, ativo: true },
  { id: "p_combo_oka", nome: "Combo Oka", descricao: "Cappuccino Oka + Sanduíche Natural + Bolo Aconchego", categoria: "combo", pontos: 900, ativo: true },
];

export const CLIENTES_INICIAIS: Cliente[] = [
  { id: "c_marina", nome: "Marina Costa", telefone: "91999990001", email: "marina.costa@email.com", criadoEm: diasAtras(60) },
  { id: "c_ana", nome: "Ana Lima", telefone: "91999990002", email: "ana.lima@email.com", criadoEm: diasAtras(85) },
  { id: "c_joao", nome: "João Pereira", telefone: "91999990003", email: "joao.pereira@email.com", criadoEm: diasAtras(40) },
  { id: "c_beatriz", nome: "Beatriz Alves", telefone: "91999990004", email: "beatriz.alves@email.com", criadoEm: diasAtras(70) },
  { id: "c_carlos", nome: "Carlos Souza", telefone: "91999990005", email: "carlos.souza@email.com", criadoEm: diasAtras(1) },
];

/** Atalho para montar compras do seed com pontos já calculados (multiplicador 1). */
function compraSeed(id: string, clienteId: string, dias: number, valor: number, hora = 9): Movimento {
  return {
    id,
    clienteId,
    tipo: "compra",
    pontos: calcularPontos(valor, REGRAS_PADRAO),
    data: diasAtras(dias, hora, 15),
    valorCompra: valor,
    descricao: `Compra de ${formatarMoeda(valor)}`,
  };
}

export const CUPONS_INICIAIS: Cupom[] = [
  // Ana: um ativo e um usado
  {
    id: "cp_ana_ativo",
    codigo: "OKA-K7RM",
    clienteId: "c_ana",
    premioId: "p_cappuccino",
    premioNome: "Cappuccino Oka",
    pontosDebitados: 250,
    criadoEm: diasAtras(2, 16, 40),
    expiraEm: calcularExpiracao(diasAtras(2, 16, 40), 10),
  },
  {
    id: "cp_ana_usado",
    codigo: "OKA-3HXP",
    clienteId: "c_ana",
    premioId: "p_bolo",
    premioNome: "Bolo Aconchego",
    pontosDebitados: 220,
    criadoEm: diasAtras(15, 11, 5),
    expiraEm: calcularExpiracao(diasAtras(15, 11, 5), 10),
    usadoEm: diasAtras(13, 15, 20),
  },
  // Beatriz: um expirado, para demonstrar o aviso no A2 e no C4
  {
    id: "cp_bea_expirado",
    codigo: "OKA-9TWD",
    clienteId: "c_beatriz",
    premioId: "p_bolo",
    premioNome: "Bolo Aconchego",
    pontosDebitados: 220,
    criadoEm: diasAtras(20, 10, 30),
    expiraEm: calcularExpiracao(diasAtras(20, 10, 30), 10),
  },
];

export const MOVIMENTOS_INICIAIS: Movimento[] = [
  // Marina Costa — 480 pts
  compraSeed("m_ma1", "c_marina", 52, 95.4),
  compraSeed("m_ma2", "c_marina", 38, 120.0, 13),
  compraSeed("m_ma3", "c_marina", 24, 78.2),
  compraSeed("m_ma4", "c_marina", 11, 112.5, 17),
  compraSeed("m_ma5", "c_marina", 3, 75.0),

  // Ana Lima — 920 pts (ajuste da migração + compras − 2 resgates)
  {
    id: "m_an1",
    clienteId: "c_ana",
    tipo: "ajuste",
    pontos: 400,
    data: diasAtras(84, 9, 0),
    descricao: "Migração do cartão de papel",
  },
  compraSeed("m_an2", "c_ana", 60, 210.0, 12),
  compraSeed("m_an3", "c_ana", 41, 245.3, 19),
  {
    id: "m_an4",
    clienteId: "c_ana",
    tipo: "resgate",
    pontos: -220,
    data: diasAtras(15, 11, 5),
    cupomId: "cp_ana_usado",
    descricao: "Resgate: Bolo Aconchego",
  },
  compraSeed("m_an5", "c_ana", 9, 180.0, 13),
  compraSeed("m_an6", "c_ana", 4, 355.0, 20),
  {
    id: "m_an7",
    clienteId: "c_ana",
    tipo: "resgate",
    pontos: -250,
    data: diasAtras(2, 16, 40),
    cupomId: "cp_ana_ativo",
    descricao: "Resgate: Cappuccino Oka",
  },

  // João Pereira — 120 pts
  compraSeed("m_jo1", "c_joao", 35, 32.0, 8),
  compraSeed("m_jo2", "c_joao", 21, 28.5),
  compraSeed("m_jo3", "c_joao", 12, 35.0, 8),
  compraSeed("m_jo4", "c_joao", 5, 25.0, 16),

  // Beatriz Alves — 310 pts (compras − 1 resgate que expirou sem uso; pontos perdidos)
  compraSeed("m_be1", "c_beatriz", 65, 98.0),
  compraSeed("m_be2", "c_beatriz", 50, 120.8, 14),
  compraSeed("m_be3", "c_beatriz", 33, 87.0),
  {
    id: "m_be4",
    clienteId: "c_beatriz",
    tipo: "resgate",
    pontos: -220,
    data: diasAtras(20, 10, 30),
    cupomId: "cp_bea_expirado",
    descricao: "Resgate: Bolo Aconchego",
  },
  compraSeed("m_be5", "c_beatriz", 14, 115.0, 18),
  compraSeed("m_be6", "c_beatriz", 7, 64.0),
  compraSeed("m_be7", "c_beatriz", 2, 46.0, 12),

  // Carlos Souza — cliente novo, sem movimentos
];

/** Saldos da tabela do escopo. Conferidos na carga, para o seed nunca divergir. */
export const SALDOS_ESPERADOS: Record<string, number> = {
  c_marina: 480,
  c_ana: 920,
  c_joao: 120,
  c_beatriz: 310,
  c_carlos: 0,
};

export function conferirSeed(): string[] {
  return Object.entries(SALDOS_ESPERADOS)
    .filter(([id, esperado]) => saldo(id, MOVIMENTOS_INICIAIS) !== esperado)
    .map(([id, esperado]) => `${id}: esperado ${esperado}, calculado ${saldo(id, MOVIMENTOS_INICIAIS)}`);
}

/* ---------- Base fictícia do dashboard ----------
 * Os números do escopo (142 clientes, 9.800 pts emitidos…) descrevem a loja
 * inteira; os 5 clientes do seed são só uma parte. A "base" abaixo representa
 * os demais clientes, calibrada para que base + seed = números do escopo no
 * período de 30 dias. O que acontecer na demo soma por cima, ao vivo.
 */

export const NUMEROS_ESCOPO = {
  clientes: 142,
  novosMes: 18,
  pontosEmitidosMes: 9800,
  pontosResgatadosMes: 2250,
  ticketMedio: 50,
  taxaRetorno: 46, // % — fictício, sem base para calcular na demo
};

export function inicioDoDia(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Gerador pseudoaleatório com semente: o gráfico é o mesmo a cada recarga. */
function mulberry32(semente: number) {
  let a = semente;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Divide um total inteiro proporcionalmente aos pesos (maiores restos). */
function distribuir(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((a, b) => a + b, 0);
  const brutos = pesos.map((w) => (total * w) / soma);
  const out = brutos.map(Math.floor);
  let falta = total - out.reduce((a, b) => a + b, 0);
  const ordem = brutos.map((b, i) => [b - Math.floor(b), i] as const).sort((x, y) => y[0] - x[0]);
  for (let k = 0; falta > 0; k++, falta--) out[ordem[k % ordem.length][1]] += 1;
  return out;
}

export type DiaBase = { compras: number; receita: number; pontos: number; novos: number; resgatados: number };

function gerarBaseDashboard(): DiaBase[] {
  const hoje = inicioDoDia(new Date());
  const desde = hoje.getTime() - 29 * DIA_MS;
  const doSeed30 = MOVIMENTOS_INICIAIS.filter((m) => new Date(m.data).getTime() >= desde);
  const comprasSeed = doSeed30.filter((m) => m.tipo === "compra");
  const ptsSeed = doSeed30.filter((m) => m.pontos > 0).reduce((a, m) => a + m.pontos, 0);
  const resgSeed = doSeed30.filter((m) => m.tipo === "resgate").reduce((a, m) => a - m.pontos, 0);
  const novosSeed = CLIENTES_INICIAIS.filter((c) => new Date(c.criadoEm).getTime() >= desde).length;

  const receitaSeed = comprasSeed.reduce((a, m) => a + (m.valorCompra ?? 0), 0);
  const comprasTotais = Math.round(NUMEROS_ESCOPO.pontosEmitidosMes / NUMEROS_ESCOPO.ticketMedio);
  const totalCompras = comprasTotais - comprasSeed.length;
  const rnd = mulberry32(42);
  const pesos = Array.from({ length: 30 }, (_, i) => {
    const dia = new Date(desde + i * DIA_MS).getDay();
    const fator = dia === 0 || dia === 6 ? 1.9 : dia === 5 ? 1.3 : 1; // picos no fim de semana
    return fator * (0.75 + 0.5 * rnd());
  });
  const compras = distribuir(totalCompras, pesos);
  const pesosValor = compras.map((c) => c * (0.85 + 0.3 * rnd()));
  // Faturamento em centavos, para o ticket médio fechar exatamente em R$ 50,00.
  const receitaCent = distribuir(Math.round((comprasTotais * NUMEROS_ESCOPO.ticketMedio - receitaSeed) * 100), pesosValor);
  const pontos = distribuir(NUMEROS_ESCOPO.pontosEmitidosMes - ptsSeed, pesosValor);
  const novos = distribuir(NUMEROS_ESCOPO.novosMes - novosSeed, pesos.map(() => 0.5 + rnd()));
  const resgatados = distribuir(NUMEROS_ESCOPO.pontosResgatadosMes - resgSeed, pesos);
  return compras.map((c, i) => ({
    compras: c,
    receita: receitaCent[i] / 100,
    pontos: pontos[i],
    novos: novos[i],
    resgatados: resgatados[i],
  }));
}

/** Índice 0 = 29 dias atrás; índice 29 = hoje. */
export const BASE_DASHBOARD = gerarBaseDashboard();
export const CLIENTES_FORA_DO_SEED = NUMEROS_ESCOPO.clientes - CLIENTES_INICIAIS.length;

export type Periodo = 7 | 30;

export type Dashboard = {
  totalClientes: number;
  novos: number;
  pontosEmitidos: number;
  pontosResgatados: number;
  ticketMedio: number;
  taxaRetorno: number;
  porDia: { data: Date; compras: number; receita: number }[];
  topClientes: { cliente: Cliente; gasto: number; compras: number }[];
};

/** Função pura: base fictícia + tudo o que está no estado (seed e demo). */
export function calcularDashboard(state: AppState, periodo: Periodo, agora = new Date()): Dashboard {
  const hoje = inicioDoDia(agora);
  const desde = hoje.getTime() - (periodo - 1) * DIA_MS;
  const base = BASE_DASHBOARD.slice(30 - periodo);
  const noPeriodo = state.movimentos.filter((m) => new Date(m.data).getTime() >= desde);

  const porDia = base.map((b, i) => {
    const ini = desde + i * DIA_MS;
    const doDia = noPeriodo.filter((m) => {
      const t = new Date(m.data).getTime();
      return m.tipo === "compra" && t >= ini && t < ini + DIA_MS;
    });
    return {
      data: new Date(ini),
      compras: b.compras + doDia.length,
      receita: b.receita + doDia.reduce((a, m) => a + (m.valorCompra ?? 0), 0),
    };
  });

  const compras = porDia.reduce((a, d) => a + d.compras, 0);
  const receita = porDia.reduce((a, d) => a + d.receita, 0);
  const gastos = new Map<string, { gasto: number; compras: number }>();
  for (const m of noPeriodo) {
    if (m.tipo !== "compra") continue;
    const g = gastos.get(m.clienteId) ?? { gasto: 0, compras: 0 };
    gastos.set(m.clienteId, { gasto: g.gasto + (m.valorCompra ?? 0), compras: g.compras + 1 });
  }

  return {
    totalClientes: CLIENTES_FORA_DO_SEED + state.clientes.length,
    novos:
      base.reduce((a, b) => a + b.novos, 0) +
      state.clientes.filter((c) => new Date(c.criadoEm).getTime() >= desde).length,
    pontosEmitidos:
      base.reduce((a, b) => a + b.pontos, 0) + noPeriodo.filter((m) => m.pontos > 0).reduce((a, m) => a + m.pontos, 0),
    pontosResgatados:
      base.reduce((a, b) => a + b.resgatados, 0) -
      noPeriodo.filter((m) => m.tipo === "resgate").reduce((a, m) => a + m.pontos, 0),
    ticketMedio: compras > 0 ? receita / compras : 0,
    taxaRetorno: NUMEROS_ESCOPO.taxaRetorno,
    porDia,
    topClientes: [...gastos.entries()]
      .map(([id, g]) => ({ cliente: state.clientes.find((c) => c.id === id)!, ...g }))
      .filter((x) => x.cliente)
      .sort((a, b) => b.gasto - a.gasto)
      .slice(0, 5),
  };
}

export const ESTADO_INICIAL: AppState = {
  clientes: CLIENTES_INICIAIS,
  premios: PREMIOS_INICIAIS,
  movimentos: MOVIMENTOS_INICIAIS,
  cupons: CUPONS_INICIAIS,
  regras: REGRAS_PADRAO,
};

/* ============================================================
 * 5. ESTADO GLOBAL (REDUCER + CONTEXT)
 * ============================================================
 * Toda mudança de dado passa por aqui. As ações recebem um `id` gerado pela
 * tela no momento em que a operação começa; se a mesma ação chegar duas vezes
 * (duplo toque), o reducer reconhece o id e ignora a repetição.
 * O reducer também reconfere as regras (saldo, status do cupom), então
 * nenhuma tela consegue deixar o estado inconsistente.
 */

export type Acao =
  | { tipo: "CADASTRAR_CLIENTE"; id: string; nome: string; telefone: string; email: string; agora: string }
  | { tipo: "REGISTRAR_COMPRA"; id: string; clienteId: string; valor: number; agora: string }
  | { tipo: "RESGATAR_PREMIO"; id: string; cupomId: string; codigo: string; clienteId: string; premioId: string; agora: string }
  | { tipo: "USAR_CUPOM"; cupomId: string; agora: string }
  | { tipo: "AJUSTAR_PONTOS"; id: string; clienteId: string; pontos: number; motivo: string; agora: string }
  | { tipo: "SALVAR_PREMIO"; premio: Premio }
  | { tipo: "ATUALIZAR_REGRAS"; regras: Regras };

export function reducer(state: AppState, acao: Acao): AppState {
  switch (acao.tipo) {
    case "CADASTRAR_CLIENTE": {
      if (state.clientes.some((c) => c.id === acao.id || c.telefone === acao.telefone)) return state;
      const novo: Cliente = {
        id: acao.id,
        nome: acao.nome.trim(),
        telefone: acao.telefone,
        email: acao.email.trim().toLowerCase(),
        criadoEm: acao.agora,
      };
      return { ...state, clientes: [...state.clientes, novo] };
    }

    case "REGISTRAR_COMPRA": {
      if (state.movimentos.some((m) => m.id === acao.id)) return state; // duplo toque
      if (!state.clientes.some((c) => c.id === acao.clienteId)) return state;
      // Pontos recalculados aqui, com a regra vigente no momento da confirmação.
      const pontos = calcularPontos(acao.valor, state.regras);
      if (pontos <= 0) return state;
      const mov: Movimento = {
        id: acao.id,
        clienteId: acao.clienteId,
        tipo: "compra",
        pontos,
        data: acao.agora,
        valorCompra: acao.valor,
        descricao: `Compra de ${formatarMoeda(acao.valor)}`,
      };
      return { ...state, movimentos: [...state.movimentos, mov] };
    }

    case "RESGATAR_PREMIO": {
      if (state.cupons.some((c) => c.id === acao.cupomId)) return state; // duplo toque
      const premio = state.premios.find((p) => p.id === acao.premioId);
      if (!premio || !premio.ativo) return state;
      if (saldo(acao.clienteId, state.movimentos) < premio.pontos) return state;
      const cupom: Cupom = {
        id: acao.cupomId,
        codigo: acao.codigo,
        clienteId: acao.clienteId,
        premioId: premio.id,
        premioNome: premio.nome,
        pontosDebitados: premio.pontos,
        criadoEm: acao.agora,
        expiraEm: calcularExpiracao(acao.agora, state.regras.validadeCupomDias),
      };
      const mov: Movimento = {
        id: acao.id,
        clienteId: acao.clienteId,
        tipo: "resgate",
        pontos: -premio.pontos,
        data: acao.agora,
        cupomId: cupom.id,
        descricao: `Resgate: ${premio.nome}`,
      };
      // Débito e cupom entram juntos: nunca existe um sem o outro.
      return { ...state, cupons: [...state.cupons, cupom], movimentos: [...state.movimentos, mov] };
    }

    case "USAR_CUPOM": {
      const cupom = state.cupons.find((c) => c.id === acao.cupomId);
      if (!cupom || statusCupom(cupom, new Date(acao.agora)) !== "ativo") return state;
      return {
        ...state,
        cupons: state.cupons.map((c) => (c.id === acao.cupomId ? { ...c, usadoEm: acao.agora } : c)),
      };
    }

    case "AJUSTAR_PONTOS": {
      if (state.movimentos.some((m) => m.id === acao.id)) return state;
      if (!Number.isInteger(acao.pontos) || acao.pontos === 0) return state;
      if (saldo(acao.clienteId, state.movimentos) + acao.pontos < 0) return state; // saldo nunca fica negativo
      const mov: Movimento = {
        id: acao.id,
        clienteId: acao.clienteId,
        tipo: "ajuste",
        pontos: acao.pontos,
        data: acao.agora,
        descricao: `Ajuste: ${acao.motivo.trim()}`,
      };
      return { ...state, movimentos: [...state.movimentos, mov] };
    }

    case "SALVAR_PREMIO": {
      const existe = state.premios.some((p) => p.id === acao.premio.id);
      return {
        ...state,
        premios: existe
          ? state.premios.map((p) => (p.id === acao.premio.id ? acao.premio : p))
          : [...state.premios, acao.premio],
      };
    }

    case "ATUALIZAR_REGRAS":
      return { ...state, regras: acao.regras };
  }
}

type Store = { state: AppState; dispatch: Dispatch<Acao> };
const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore precisa estar dentro de <StoreProvider>");
  return ctx;
}

function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, ESTADO_INICIAL);
  const valor = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreContext.Provider value={valor}>{children}</StoreContext.Provider>;
}

/* ============================================================
 * 6. ESTILOS
 * ============================================================
 * CSS embutido, sem Tailwind: o arquivo roda num projeto Vite padrão
 * sem configuração extra. Cores estimadas no escopo (a confirmar).
 */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');

.oka {
  --oliva: #7D8F4F;
  --oliva-escuro: #66763F;
  --creme: #EDE3CC;
  --creme-claro: #F7F2E6;
  --branco: #FFFFFF;
  --verde-escuro: #1E3B2A;
  --marrom: #7B4B3A;
  --amarelo: #F2A81D;
  --quase-preto: #10161A;
  --erro: #A3362B;
  --erro-fundo: #F8E1DC;
  --ok-fundo: #E3EBD3;
  --borda: #D9CDB0;
  --raio: 14px;

  min-height: 100vh;
  background: var(--creme-claro);
  color: var(--verde-escuro);
  font-family: Inter, system-ui, -apple-system, sans-serif;
  font-size: 16px;
  line-height: 1.45;
}
.oka *, .oka *::before, .oka *::after { box-sizing: border-box; }
.oka h1, .oka h2, .oka h3 { font-family: Fraunces, Georgia, serif; margin: 0; line-height: 1.15; }

/* Barra fixa da demo */
.oka-topo {
  position: sticky; top: 0; z-index: 60; /* acima do modal: a troca de visão nunca fica bloqueada */
  background: var(--quase-preto); color: var(--branco);
  padding: 8px 12px;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.oka-marca { display: flex; flex-direction: column; line-height: 1; }
.oka-marca b { font-family: Fraunces, Georgia, serif; font-weight: 400; letter-spacing: .18em; font-size: 22px; }
.oka-marca small { font-size: 8px; letter-spacing: .14em; white-space: nowrap; text-transform: uppercase; opacity: .75; margin-top: 3px; }
@media (max-width: 380px) {
  .oka-marca small { display: none; }
  .oka-seletor button { padding: 0 9px !important; font-size: 13px !important; }
}
.oka-seletor { flex: 0 0 auto; display: flex; background: #22292E; border-radius: 999px; padding: 3px; }
.oka-seletor button {
  min-height: 44px; padding: 0 10px; border: 0; border-radius: 999px;
  background: transparent; color: #C9CFC4; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
}
.oka-seletor button[aria-pressed="true"] { background: var(--oliva); color: var(--branco); }

.oka-conteudo { max-width: 480px; margin: 0 auto; padding: 16px 16px 48px; }
.oka-conteudo.largo { max-width: 1080px; }

/* Botões e campos */
.oka-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 48px; padding: 0 20px; border-radius: 999px; border: 0;
  font: inherit; font-weight: 600; cursor: pointer;
  background: var(--oliva); color: var(--branco);
}
.oka-btn:hover { background: var(--oliva-escuro); }
.oka-btn:disabled { opacity: .45; cursor: not-allowed; }
.oka-btn.sec { background: transparent; color: var(--verde-escuro); box-shadow: inset 0 0 0 1.5px var(--verde-escuro); }
.oka-btn.sec:hover { background: rgba(30,59,42,.06); }
.oka-btn.bloco { width: 100%; }

.oka-campo { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.oka-campo label { font-size: 14px; font-weight: 600; }
.oka-campo input, .oka-campo select {
  min-height: 48px; padding: 0 14px; font: inherit; font-size: 16px;
  border: 1.5px solid var(--borda); border-radius: 10px; background: var(--branco); color: var(--verde-escuro);
}
.oka-campo input:focus, .oka-campo select:focus { outline: 2px solid var(--oliva); outline-offset: 1px; border-color: var(--oliva); }
.oka-campo .erro { color: var(--erro); font-size: 14px; }

.oka-card { background: var(--branco); border-radius: var(--raio); padding: 16px; box-shadow: 0 1px 0 var(--borda); }
.oka-aviso { border-radius: 10px; padding: 12px 14px; font-size: 15px; }
.oka-aviso.erro { background: var(--erro-fundo); color: var(--erro); }
.oka-aviso.ok { background: var(--ok-fundo); color: var(--verde-escuro); }
.oka-aviso.atencao { background: #FCEBC4; color: #6B4A06; }

.oka-placeholder { text-align: center; padding: 48px 16px; color: var(--marrom); }

/* Utilidades */
.pilha > * + * { margin-top: 12px; }
.linha { display: flex; align-items: center; gap: 12px; }
.entre { justify-content: space-between; }
.mudo { color: #5E6B5F; font-size: 14px; }
.titulo-tela { font-size: 26px; margin: 4px 0 14px; }
.subtitulo { font-family: Inter, system-ui, sans-serif !important; font-size: 13px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--marrom); margin: 18px 0 8px; }
.oka-link { background: none; border: 0; padding: 0 4px; min-height: 44px; color: var(--oliva-escuro); font: inherit; font-weight: 600; text-decoration: underline; cursor: pointer; }

/* Abas (atendente, dono, vitrine) */
.oka-abas { display: flex; gap: 5px; overflow-x: auto; padding-bottom: 2px; margin-bottom: 14px; scrollbar-width: none; }
.oka-abas button {
  flex: 1 0 auto; min-height: 44px; padding: 0 10px; border-radius: 999px; white-space: nowrap;
  border: 1.5px solid var(--borda); background: var(--branco); color: var(--verde-escuro);
  font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
}
@media (max-width: 420px) { .oka-abas button { padding: 0 8px; font-size: 13.5px; } }
.oka-abas button[aria-selected="true"] { background: var(--verde-escuro); border-color: var(--verde-escuro); color: var(--branco); }

/* Navegação inferior do cliente */
.oka-nav-cliente {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
  background: var(--branco); border-top: 1px solid var(--borda);
  display: flex; justify-content: center; padding-bottom: env(safe-area-inset-bottom);
}
.oka-nav-cliente > div { display: flex; width: 100%; max-width: 480px; }
.oka-nav-cliente button {
  flex: 1; min-height: 58px; border: 0; background: none; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  font: inherit; font-size: 12px; font-weight: 600; color: #7A8478;
}
.oka-nav-cliente button[aria-current="page"] { color: var(--oliva-escuro); }
.com-nav { padding-bottom: 84px; }

/* Cartão digital (C2) */
.oka-cartao {
  background: var(--oliva); color: var(--branco); border-radius: 20px; padding: 20px 18px 22px;
  position: relative; overflow: hidden;
}
.oka-cartao::after {
  content: ""; position: absolute; right: -40px; top: -40px; width: 160px; height: 160px;
  border-radius: 50%; border: 1px solid rgba(255,255,255,.18);
}
.oka-cartao .club { font-family: Fraunces, Georgia, serif; letter-spacing: .32em; font-size: 15px; text-transform: uppercase; }
.oka-cartao .slogan { font-family: Fraunces, Georgia, serif; font-style: italic; font-size: 14px; opacity: .9; }
.oka-cartao .saldo { font-family: Fraunces, Georgia, serif; font-size: 52px; font-weight: 600; line-height: 1; margin-top: 14px; }
.oka-cartao .saldo small { font-family: Inter, sans-serif; font-size: 15px; font-weight: 500; margin-left: 6px; opacity: .9; }

.regua { position: relative; margin: 26px 6px 6px; height: 62px; }
.regua .trilho { position: absolute; left: 0; right: 0; top: 21px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.25); }
.regua .preenchido { position: absolute; left: 0; top: 21px; height: 4px; border-radius: 2px; background: var(--creme); transition: width .5s ease; }
.regua .marco {
  position: absolute; top: 0; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
.regua .bolinha {
  width: 46px; height: 46px; border-radius: 50%;
  display: grid; place-items: center;
  border: 1.5px solid rgba(255,255,255,.55); background: var(--oliva); color: rgba(255,255,255,.8);
}
.regua .marco.ok .bolinha { background: var(--creme); border-color: var(--creme); color: var(--verde-escuro); }
.regua .marco.topo .bolinha { border-color: var(--amarelo); }
.regua .marco.topo.ok .bolinha { background: var(--amarelo); border-color: var(--amarelo); color: var(--quase-preto); }
.regua .marco span { font-size: 12px; font-weight: 700; letter-spacing: .04em; }
.regua .marco.inicio { transform: none; }

/* Extrato */
.mov { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #EEE6D3; }
.mov:last-child { border-bottom: 0; }
.mov .tipo {
  flex: 0 0 auto; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  padding: 4px 8px; border-radius: 6px; background: var(--creme); color: var(--verde-escuro); min-width: 72px; text-align: center;
}
.mov .tipo.resgate { background: #F3E0D6; color: var(--marrom); }
.mov .tipo.ajuste, .mov .tipo.estorno { background: #FCEBC4; color: #6B4A06; }
.mov .meio { flex: 1; min-width: 0; }
.mov .meio div { font-weight: 500; overflow-wrap: anywhere; }
.mov .meio small { color: var(--marrom); font-size: 13px; }
.mov .pts { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.mov .pts.pos { color: var(--oliva-escuro); }
.mov .pts.neg { color: var(--marrom); }

/* Atendente */
.resultado-busca { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.resultado-busca button {
  display: flex; justify-content: space-between; align-items: center; gap: 12px; text-align: left;
  min-height: 56px; padding: 10px 14px; border-radius: 10px; border: 1.5px solid var(--borda);
  background: var(--branco); font: inherit; color: var(--verde-escuro); cursor: pointer;
}
.resultado-busca button:hover { border-color: var(--oliva); }
.cliente-achado { background: var(--creme); border-radius: var(--raio); padding: 14px 16px; margin-bottom: 14px; }
.cliente-achado .nome { font-family: Fraunces, Georgia, serif; font-size: 22px; font-weight: 600; }
.previa-pontos { font-size: 15px; margin: -4px 0 14px; color: var(--oliva-escuro); font-weight: 600; }

/* Modal */
.oka-fundo-modal {
  position: fixed; inset: 0; z-index: 50; background: rgba(16,22,26,.55);
  display: flex; align-items: flex-end; justify-content: center;
}
.oka-modal {
  background: var(--creme-claro); width: 100%; max-width: 480px; max-height: calc(100vh - 80px); overflow-y: auto;
  border-radius: 20px 20px 0 0; padding: 20px 16px calc(20px + env(safe-area-inset-bottom));
}
@media (min-width: 640px) {
  .oka-fundo-modal { align-items: center; }
  .oka-modal { border-radius: 20px; }
}
.oka-modal h2 { font-size: 24px; margin-bottom: 14px; }
.oka-modal .acoes { display: flex; gap: 10px; margin-top: 18px; }
.oka-modal .acoes > * { flex: 1; padding: 0 12px; white-space: nowrap; }
.resumo { background: var(--branco); border-radius: 12px; padding: 4px 14px; }
.resumo > div { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid #EEE6D3; }
.resumo > div:last-child { border-bottom: 0; }
.resumo dt { color: #5E6B5F; }
.resumo dd { margin: 0; font-weight: 600; text-align: right; }
.resumo .destaque { font-size: 20px; color: var(--marrom); }
.check-extra { display: flex; gap: 10px; align-items: flex-start; margin-top: 12px; font-size: 15px; cursor: pointer; min-height: 44px; }
.check-extra input { width: 22px; height: 22px; margin-top: 1px; accent-color: var(--oliva); flex: 0 0 auto; }

.sucesso { text-align: center; padding: 28px 8px; }
.sucesso .grande { font-family: Fraunces, Georgia, serif; font-size: 44px; font-weight: 600; color: var(--oliva-escuro); }
/* Vitrine (C3) */
.barra-saldo {
  position: sticky; top: 66px; z-index: 10; margin: 0 -16px 12px; padding: 10px 16px;
  background: var(--verde-escuro); color: var(--branco);
  display: flex; justify-content: space-between; align-items: center;
}
.barra-saldo strong { font-family: Fraunces, Georgia, serif; font-size: 22px; }
.vitrine { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.premio {
  background: var(--branco); border-radius: var(--raio); padding: 14px 12px 12px;
  display: flex; flex-direction: column; gap: 6px; box-shadow: 0 1px 0 var(--borda); position: relative;
}
.premio .arte { width: 64px; height: 64px; border-radius: 50%; background: var(--creme); color: var(--verde-escuro); display: grid; place-items: center; margin: 2px auto 6px; }
.premio .nome { font-weight: 600; line-height: 1.25; }
.premio .desc { font-size: 13px; color: #5E6B5F; line-height: 1.3; }
.premio .pts { font-family: Fraunces, Georgia, serif; font-size: 20px; font-weight: 600; color: var(--marrom); margin-top: auto; }
.premio .oka-btn { min-height: 44px; padding: 0 10px; font-size: 15px; }
.premio.bloqueado .arte { opacity: .45; }
.premio.bloqueado .nome, .premio.bloqueado .pts { opacity: .6; }
.premio .cadeado { position: absolute; top: 10px; right: 10px; color: var(--marrom); }
.premio .falta { font-size: 13px; font-weight: 600; color: var(--erro); }

/* Cupons (C4) */
.cupom {
  background: var(--branco); border-radius: var(--raio); padding: 14px; box-shadow: 0 1px 0 var(--borda);
  display: flex; gap: 14px; align-items: center; width: 100%; text-align: left;
  border: 0; font: inherit; color: inherit; cursor: pointer; min-height: 44px;
}
.cupom + .cupom { margin-top: 10px; }
.cupom .qr-mini { flex: 0 0 auto; width: 76px; }
.cupom .info { flex: 1; min-width: 0; }
.cupom .info strong { display: block; font-size: 17px; }
.codigo { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; letter-spacing: .08em; }
.etiqueta { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 3px 8px; border-radius: 6px; }
.etiqueta.ativo { background: var(--ok-fundo); color: var(--oliva-escuro); }
.etiqueta.usado { background: #E6E6E1; color: #4F5650; }
.etiqueta.expirado { background: var(--erro-fundo); color: var(--erro); }
.cupom.inativo { opacity: .75; cursor: default; }
.cupom-aberto { text-align: center; }
.cupom-aberto .qr-grande { width: min(240px, 70vw); margin: 4px auto 10px; background: var(--branco); padding: 12px; border-radius: 12px; }
.cupom-aberto .codigo { font-size: 28px; display: block; margin: 4px 0; }

.oka-campo input.codigo { text-transform: uppercase; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; }
/* Painel do dono */
.kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
@media (min-width: 760px) { .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.kpi { background: var(--branco); border-radius: var(--raio); padding: 14px; box-shadow: 0 1px 0 var(--borda); }
.kpi span { display: block; font-size: 13px; color: #5E6B5F; }
.kpi strong { display: block; font-family: Fraunces, Georgia, serif; font-size: 28px; font-weight: 600; margin-top: 2px; font-variant-numeric: tabular-nums; }
.kpi small { color: var(--marrom); font-size: 12px; }
.dash-grade { display: grid; gap: 14px; }
@media (min-width: 900px) { .dash-grade { grid-template-columns: 2fr 1fr; align-items: start; } }
.grafico-leitura { min-height: 24px; font-size: 14px; margin: 2px 0 8px; color: #5E6B5F; }
.grafico-leitura strong { color: var(--verde-escuro); font-size: 16px; }
.grafico { position: relative; height: 170px; }
.grafico .grade { position: absolute; left: 0; right: 0; border-top: 1px solid #EEE6D3; font-size: 11px; color: #8A9187; }
.grafico .grade span { position: absolute; top: -8px; left: 0; background: var(--branco); padding-right: 4px; }
.grafico .barras { position: absolute; inset: 0 0 0 28px; display: flex; align-items: flex-end; gap: 2px; }
.grafico .barra {
  flex: 1; height: 100%; display: flex; align-items: flex-end; border: 0; padding: 0; background: none; cursor: pointer; min-width: 0;
}
.grafico .barra i { display: block; width: 100%; background: var(--oliva); border-radius: 4px 4px 0 0; transition: filter .15s; }
.grafico .barra:hover i, .grafico .barra:focus-visible i, .grafico .barra[aria-pressed="true"] i { filter: brightness(.82); }
.grafico .barra:focus-visible { outline: 2px solid var(--verde-escuro); outline-offset: 1px; }
.eixo-x { display: flex; gap: 2px; margin-left: 28px; margin-top: 4px; font-size: 11px; color: #8A9187; }
.eixo-x span:last-child { text-align: right; }
.eixo-x span { flex: 1; text-align: center; min-width: 0; white-space: nowrap; overflow: visible; }
.tabela-simples { width: 100%; border-collapse: collapse; font-size: 14px; }
.tabela-simples th, .tabela-simples td { text-align: left; padding: 6px 4px; border-bottom: 1px solid #EEE6D3; }
.tabela-simples td.num, .tabela-simples th.num { text-align: right; font-variant-numeric: tabular-nums; }
details summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; font-weight: 600; color: var(--oliva-escuro); }

.lista-linhas { display: flex; flex-direction: column; gap: 8px; }
.linha-item {
  display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center; width: 100%; text-align: left;
  background: var(--branco); border: 0; border-radius: 12px; padding: 12px 14px; box-shadow: 0 1px 0 var(--borda);
  font: inherit; color: inherit; cursor: pointer; min-height: 56px;
}
.linha-item:hover { box-shadow: inset 0 0 0 1.5px var(--oliva); }
.linha-item .sec-info { font-size: 13px; color: #5E6B5F; }
@media (min-width: 760px) {
  .linha-item.cliente { grid-template-columns: 2fr 1.3fr 1fr 1.2fr; }
  .cabecalho-lista { display: grid !important; }
}
.cabecalho-lista { display: none; grid-template-columns: 2fr 1.3fr 1fr 1.2fr; gap: 12px; padding: 0 14px 4px; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--marrom); }

.premio-linha { display: flex; align-items: center; gap: 12px; background: var(--branco); border-radius: 12px; padding: 10px 12px; box-shadow: 0 1px 0 var(--borda); }
.premio-linha .arte-mini { width: 44px; height: 44px; border-radius: 50%; background: var(--creme); display: grid; place-items: center; flex: 0 0 auto; }
.premio-linha .meio { flex: 1; min-width: 0; }
.premio-linha.inativo .meio, .premio-linha.inativo .arte-mini { opacity: .5; }
.interruptor { position: relative; width: 52px; height: 44px; flex: 0 0 auto; cursor: pointer; display: grid; place-items: center; }
.interruptor input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.interruptor span { pointer-events: none; width: 44px; height: 26px; border-radius: 13px; background: #C9C3B3; position: relative; transition: background .2s; }
.interruptor span::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .2s; }
.interruptor input:checked + span { background: var(--oliva); }
.interruptor input:checked + span::after { transform: translateX(18px); }
.interruptor input:focus-visible + span { outline: 2px solid var(--verde-escuro); outline-offset: 2px; }
.btn-icone { min-height: 44px; min-width: 44px; border: 0; background: none; color: var(--verde-escuro); cursor: pointer; border-radius: 10px; display: grid; place-items: center; font: inherit; font-weight: 600; padding: 0 8px; }
.btn-icone:hover { background: var(--creme); }
.segmentado { display: flex; gap: 6px; }
.segmentado button { flex: 1; min-height: 44px; border-radius: 10px; border: 1.5px solid var(--borda); background: var(--branco); font: inherit; font-weight: 600; cursor: pointer; color: var(--verde-escuro); }
.segmentado button[aria-pressed="true"] { border-color: var(--oliva); background: var(--ok-fundo); }
.ajuda { font-size: 13px; color: #5E6B5F; }

.campo-demo {
  display: flex; align-items: center; gap: 8px; margin-bottom: 14px;
  padding: 6px 10px; border: 1px dashed var(--borda); border-radius: 10px; font-size: 13px; color: var(--marrom);
}
.campo-demo label { font-weight: 600; white-space: nowrap; }
.campo-demo select { flex: 1; min-width: 0; min-height: 44px; font: inherit; font-size: 16px; border: 0; background: transparent; color: var(--verde-escuro); font-weight: 600; }
.selo-ok { width: 64px; height: 64px; border-radius: 50%; background: var(--oliva); color: var(--branco); display: grid; place-items: center; margin: 0 auto 12px; }
`;

/* ============================================================
 * 7. COMPONENTES COMPARTILHADOS
 * ============================================================ */

function Marca() {
  return (
    <div className="oka-marca" aria-label="Oka café & comedoria">
      <b>OKA</b>
      <small>café &amp; comedoria</small>
    </div>
  );
}

/* ---------- Ícones de traço fino (lembram as ilustrações do cartão) ---------- */

type NomeIcone =
  | "check" | "cadeado" | "casa" | "presente" | "cupom" | "lista" | "usuario" | "busca"
  | "qr" | "aviso" | "estrela" | "mais" | "grafico" | "pessoas" | "ajustes" | "lapis"
  | CategoriaPremio;

const CAMINHOS: Record<NomeIcone, ReactNode> = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  cadeado: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  casa: (
    <>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 9.5V20h12V9.5" />
    </>
  ),
  presente: (
    <>
      <rect x="4" y="9" width="16" height="11" rx="1.5" />
      <path d="M3 9h18M12 9v11" />
      <path d="M12 9c-1.5-3-5-4-5.5-2S9 9 12 9zm0 0c1.5-3 5-4 5.5-2S15 9 12 9z" />
    </>
  ),
  cupom: (
    <>
      <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z" />
      <path d="M14 8v8" strokeDasharray="1.5 2" />
    </>
  ),
  lista: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  usuario: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  busca: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" />
      <rect x="14" y="4" width="6" height="6" />
      <rect x="4" y="14" width="6" height="6" />
      <path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18v2M18 14h2" />
    </>
  ),
  aviso: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  ),
  estrela: <path d="M12 4l2.4 5 5.4.7-4 3.7 1 5.4L12 16.3l-4.8 2.5 1-5.4-4-3.7 5.4-.7z" />,
  mais: <path d="M12 5v14M5 12h14" />,
  lapis: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  grafico: <path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" />,
  pessoas: (
    <>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M3.5 19c1-3 3-4.5 5.5-4.5s4.5 1.5 5.5 4.5" />
      <path d="M15.5 6.2a3 3 0 0 1 0 5.6M17 14.8c1.7.5 2.9 1.9 3.5 4.2" />
    </>
  ),
  ajustes: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" />,
  "cafe-gelado": (
    <>
      <path d="M7 7h10l-1.3 13H8.3z" />
      <path d="M13.5 7l2-4h2" />
      <path d="M7.6 12h8.8" />
      <rect x="9.5" y="14" width="2.6" height="2.6" rx=".5" />
    </>
  ),
  cafe: (
    <>
      <path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" />
      <path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16" />
      <path d="M9 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3" />
    </>
  ),
  salgado: (
    <>
      <path d="M4 11a8 5 0 0 1 16 0v1H4z" />
      <path d="M3.5 14.5h17" />
      <path d="M5 17.5h14a1 1 0 0 1-1 1.5H6a1 1 0 0 1-1-1.5z" />
    </>
  ),
  doce: (
    <>
      <path d="M4 20h16v-7H4z" />
      <path d="M4 13l8-6 8 6" />
      <path d="M4 16.5h16M12 7V4.5" />
    </>
  ),
  combo: (
    <>
      <path d="M3 10h9v4a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
      <path d="M14 19h7v-5h-7z" />
      <path d="M14 14l3.5-3 3.5 3" />
    </>
  ),
};

function Icone({ nome, tamanho = 22 }: { nome: NomeIcone; tamanho?: number }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {CAMINHOS[nome]}
    </svg>
  );
}

/* ---------- Modal (folha inferior no celular, centralizado no desktop) ---------- */

function Modal({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  // Um toque duplo apressado não pode fechar o modal que acabou de abrir com o primeiro toque.
  // Por isso o modal ignora toques nos primeiros 400 ms (no fundo e nos botões).
  const [abertoEm] = useState(() => Date.now());
  const [pronto, setPronto] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPronto(true), 400);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aoFechar]);

  return (
    <div className="oka-fundo-modal" onClick={() => Date.now() - abertoEm > 400 && aoFechar()}>
      <div
        className="oka-modal"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        style={pronto ? undefined : { pointerEvents: "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{titulo}</h2>
        {children}
      </div>
    </div>
  );
}

/* ---------- Abas ---------- */

function Abas<T extends string>(props: {
  itens: readonly { id: T; rotulo: string }[];
  valor: T;
  aoMudar: (v: T) => void;
  rotulo: string;
}) {
  return (
    <div className="oka-abas" role="tablist" aria-label={props.rotulo}>
      {props.itens.map((i) => (
        <button key={i.id} role="tab" aria-selected={props.valor === i.id} onClick={() => props.aoMudar(i.id)}>
          {i.rotulo}
        </button>
      ))}
    </div>
  );
}

/* ---------- Extrato ---------- */

const ROTULO_TIPO: Record<TipoMovimento, string> = {
  compra: "Compra",
  resgate: "Resgate",
  ajuste: "Ajuste",
  estorno: "Estorno",
};

/** Texto da linha sem repetir o tipo, que já aparece na etiqueta. */
function textoMovimento(m: Movimento): string {
  if (m.tipo === "compra" && m.valorCompra !== undefined) return formatarMoeda(m.valorCompra);
  return m.descricao.replace(/^(Resgate|Ajuste): /, "");
}

function LinhaMovimento({ m }: { m: Movimento }) {
  return (
    <div className="mov">
      <span className={`tipo ${m.tipo}`}>{ROTULO_TIPO[m.tipo]}</span>
      <div className="meio">
        <div>{textoMovimento(m)}</div>
        <small>{formatarDataHora(m.data)}</small>
      </div>
      <span className={`pts ${m.pontos >= 0 ? "pos" : "neg"}`}>
        {m.pontos >= 0 ? "+" : "−"}
        {formatarPontos(Math.abs(m.pontos))}
      </span>
    </div>
  );
}

/* ---------- Régua de marcos (C2) ---------- */

export function proximoMarco(s: number): number | null {
  return MARCOS.find((m) => s < m) ?? null;
}

function ReguaMarcos({ saldoAtual }: { saldoAtual: number }) {
  const topo = MARCOS[MARCOS.length - 1];
  const progresso = Math.min(saldoAtual / topo, 1) * 100;
  return (
    <div className="regua" role="img" aria-label={`Régua de pontos: ${formatarPontos(saldoAtual)} de ${formatarPontos(topo)}`}>
      <div className="trilho" />
      <div className="preenchido" style={{ width: `${progresso}%` }} />
      {MARCOS.map((m, i) => {
        const ok = saldoAtual >= m;
        const ehTopo = i === MARCOS.length - 1;
        return (
          <div
            key={m}
            className={`marco${ok ? " ok" : ""}${ehTopo ? " topo" : ""}`}
            style={{ left: `${((i + 1) / MARCOS.length) * 100}%`, transform: ehTopo ? "translateX(-100%)" : undefined }}
          >
            <div className="bolinha">
              <Icone nome={ok ? (ehTopo ? "estrela" : "check") : "cadeado"} tamanho={20} />
            </div>
            <span>{ehTopo ? `${formatarPontos(m)}+` : formatarPontos(m)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- QR ilustrativo ---------- */

/**
 * Desenho de QR gerado a partir do código do cupom: sempre o mesmo desenho
 * para o mesmo código, com os três quadrados de canto de um QR real.
 * É só visual (a leitura real pela câmera está fora do escopo); no projeto
 * real, trocar por uma lib como `qrcode` sem mudar quem usa o componente.
 */
function QrCupom({ codigo, tamanho = "100%" }: { codigo: string; tamanho?: string | number }) {
  const N = 25;
  const celulas = useMemo(() => {
    let h = 2166136261;
    for (const ch of codigo) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const aleatorio = () => {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      return (h >>> 0) / 4294967296;
    };
    const ehFinder = (x: number, y: number) =>
      (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);
    const out: [number, number][] = [];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (ehFinder(x, y)) continue;
        if (y === 6 || x === 6 ? (x + y) % 2 === 0 : aleatorio() < 0.48) out.push([x, y]);
      }
    return out;
  }, [codigo]);

  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width={7} height={7} fill="#10161A" />
      <rect x={x + 1} y={y + 1} width={5} height={5} fill="#fff" />
      <rect x={x + 2} y={y + 2} width={3} height={3} fill="#10161A" />
    </g>
  );

  return (
    <svg viewBox={`-1 -1 ${N + 2} ${N + 2}`} width={tamanho} role="img" aria-label={`QR do cupom ${codigo}`} shapeRendering="crispEdges" style={{ display: "block" }}>
      <rect x={-1} y={-1} width={N + 2} height={N + 2} fill="#fff" />
      {celulas.map(([x, y]) => (
        <rect key={`${x}.${y}`} x={x} y={y} width={1} height={1} fill="#10161A" />
      ))}
      {finder(0, 0)}
      {finder(N - 7, 0)}
      {finder(0, N - 7)}
    </svg>
  );
}

const ROTULO_STATUS: Record<StatusCupom, string> = { ativo: "Ativo", usado: "Usado", expirado: "Expirado" };

/* ============================================================
 * 8. TELAS DO CLIENTE
 * ============================================================ */

type TelaCliente = "inicio" | "premios" | "cupons" | "historico";

/** C1 Cadastro (formulário → "confirme seu e-mail" → entra com saldo zero) */
function TelaCadastro({ aoEntrar }: { aoEntrar: (clienteId: string) => void }) {
  const { state, dispatch } = useStore();
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [erros, setErros] = useState<{ nome?: string; telefone?: string; email?: string }>({});
  const [criado, setCriado] = useState<{ id: string; email: string } | null>(null);

  function criarConta() {
    const nomeLimpo = nome.trim().replace(/\s+/g, " ");
    const tel = normalizarTelefone(telefone);
    const e: typeof erros = {};
    if (nomeLimpo.length < 2) e.nome = "Informe seu nome.";
    if (!telefone.trim()) e.telefone = "Informe seu telefone com DDD.";
    else if (!tel) e.telefone = "Telefone inválido. Use o DDD, por exemplo (91) 98888-7777.";
    else if (state.clientes.some((c) => c.telefone === tel))
      e.telefone = "Este telefone já tem conta no Club OKA. É só informar o número no balcão.";
    if (!email.trim()) e.email = "Informe seu e-mail.";
    else if (!emailValido(email)) e.email = "E-mail inválido.";
    setErros(e);
    if (Object.keys(e).length > 0 || !tel) return;

    const id = novoId("cli");
    dispatch({ tipo: "CADASTRAR_CLIENTE", id, nome: nomeLimpo, telefone: tel, email, agora: new Date().toISOString() });
    setCriado({ id, email: email.trim().toLowerCase() });
  }

  if (criado) {
    return (
      <div className="oka-card sucesso">
        <div className="selo-ok">
          <Icone nome="check" tamanho={32} />
        </div>
        <h1 style={{ fontSize: 26, marginBottom: 8 }}>Confirme seu e-mail</h1>
        <p style={{ marginTop: 0 }}>
          Enviamos um link de confirmação para <strong>{criado.email}</strong>.
        </p>
        <p className="mudo">Na demo nenhum e-mail é enviado de verdade.</p>
        <button className="oka-btn bloco" onClick={() => aoEntrar(criado.id)}>
          Entrar no Club OKA
        </button>
      </div>
    );
  }

  return (
    <div>
      <section className="oka-cartao" style={{ marginBottom: 18 }}>
        <div className="club">Club OKA</div>
        <div className="slogan">Quem volta, faz parte da casa.</div>
        <p style={{ margin: "14px 0 0", fontSize: 15 }}>
          Ganhe {formatarPontos(state.regras.pontosPorReal)} {state.regras.pontosPorReal === 1 ? "ponto" : "pontos"} a cada
          R$ 1 e troque por prêmios da casa.
        </p>
      </section>
      <h1 className="titulo-tela">Criar conta</h1>
      <form
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          criarConta();
        }}
      >
        <div className="oka-campo">
          <label htmlFor="c1-nome">Nome</label>
          <input id="c1-nome" value={nome} autoComplete="name" onChange={(e) => {
              setNome(e.target.value);
              setErros((x) => ({ ...x, nome: undefined }));
            }} />
          {erros.nome && <span className="erro">{erros.nome}</span>}
        </div>
        <div className="oka-campo">
          <label htmlFor="c1-tel">Telefone (com DDD)</label>
          <input
            id="c1-tel"
            value={telefone}
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="(91) 98888-7777"
            onChange={(e) => {
              setTelefone(e.target.value);
              setErros((x) => ({ ...x, telefone: undefined }));
            }}
            onBlur={() => {
              const t = normalizarTelefone(telefone);
              if (t) setTelefone(formatarTelefone(t));
            }}
          />
          {erros.telefone && <span className="erro">{erros.telefone}</span>}
        </div>
        <div className="oka-campo">
          <label htmlFor="c1-email">E-mail</label>
          <input
            id="c1-email"
            type="email"
            value={email}
            inputMode="email"
            autoComplete="email"
            onChange={(e) => {
              setEmail(e.target.value);
              setErros((x) => ({ ...x, email: undefined }));
            }}
          />
          {erros.email && <span className="erro">{erros.email}</span>}
        </div>
        <button type="submit" className="oka-btn bloco">
          Criar conta
        </button>
        <p className="mudo" style={{ textAlign: "center" }}>
          Seu telefone é a sua identificação no balcão.
        </p>
      </form>
    </div>
  );
}

/** C3 Prêmios — vitrine por faixa de pontos */
function TelaPremios({ cliente, aoResgatar }: { cliente: Cliente; aoResgatar: (cupomId: string) => void }) {
  const { state, dispatch } = useStore();
  const s = saldo(cliente.id, state.movimentos);
  // Abre na faixa do saldo atual: é onde estão os prêmios mais próximos de alcançar.
  const [faixa, setFaixa] = useState<FaixaId>(() => faixaDe(Math.max(s, 1)));
  const [escolhido, setEscolhido] = useState<{ premioId: string; opId: string; cupomId: string } | null>(null);

  const ativos = state.premios.filter((p) => p.ativo).sort((a, b) => a.pontos - b.pontos);
  const daFaixa = ativos.filter((p) => faixaDe(p.pontos) === faixa);
  const premio = escolhido ? state.premios.find((p) => p.id === escolhido.premioId) : undefined;
  const validade = calcularExpiracao(new Date().toISOString(), state.regras.validadeCupomDias);

  function confirmar() {
    if (!escolhido || !premio) return;
    const codigos = new Set(state.cupons.map((c) => c.codigo));
    dispatch({
      tipo: "RESGATAR_PREMIO",
      id: escolhido.opId,
      cupomId: escolhido.cupomId,
      codigo: gerarCodigoCupom(codigos),
      clienteId: cliente.id,
      premioId: premio.id,
      agora: new Date().toISOString(),
    });
    setEscolhido(null);
    aoResgatar(escolhido.cupomId);
  }

  return (
    <div>
      <h1 className="titulo-tela">Prêmios</h1>
      <div className="barra-saldo">
        <span>Seu saldo</span>
        <strong>{formatarPontos(s)} pts</strong>
      </div>
      <Abas
        itens={FAIXAS.map((f) => ({ id: f.id, rotulo: f.rotulo }))}
        valor={faixa}
        aoMudar={setFaixa}
        rotulo="Faixas de pontos"
      />
      {daFaixa.length === 0 ? (
        <p className="oka-placeholder">Nenhum prêmio nesta faixa no momento.</p>
      ) : (
        <div className="vitrine">
          {daFaixa.map((p) => {
            const falta = p.pontos - s;
            const bloqueado = falta > 0;
            return (
              <article key={p.id} className={`premio${bloqueado ? " bloqueado" : ""}`}>
                {bloqueado && (
                  <span className="cadeado" aria-hidden="true">
                    <Icone nome="cadeado" tamanho={18} />
                  </span>
                )}
                <div className="arte">
                  <Icone nome={p.categoria} tamanho={34} />
                </div>
                <div className="nome">{p.nome}</div>
                {p.descricao && <div className="desc">{p.descricao}</div>}
                <div className="pts">{formatarPontos(p.pontos)} pts</div>
                {bloqueado ? (
                  <>
                    <div className="falta">Saldo insuficiente: faltam {formatarPontos(falta)} pts</div>
                    <button className="oka-btn" disabled>
                      Resgatar
                    </button>
                  </>
                ) : (
                  <button
                    className="oka-btn"
                    onClick={() => setEscolhido({ premioId: p.id, opId: novoId("mov"), cupomId: novoId("cup") })}
                  >
                    Resgatar
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}

      {escolhido && premio && (
        <Modal titulo="Confirmar resgate" aoFechar={() => setEscolhido(null)}>
          <p style={{ marginTop: 0 }}>
            Trocar <strong>{formatarPontos(premio.pontos)} pontos</strong> por <strong>{premio.nome}</strong>?
          </p>
          <dl className="resumo">
            <div>
              <dt>Saldo atual</dt>
              <dd>{formatarPontos(s)} pts</dd>
            </div>
            <div>
              <dt>Saldo depois</dt>
              <dd>{formatarPontos(s - premio.pontos)} pts</dd>
            </div>
            <div>
              <dt>Cupom válido até</dt>
              <dd>{formatarData(validade)}</dd>
            </div>
          </dl>
          <p className="mudo">Os pontos saem na hora. Se o cupom não for usado até a validade, os pontos não voltam.</p>
          <div className="acoes">
            <button className="oka-btn sec" onClick={() => setEscolhido(null)}>
              Cancelar
            </button>
            <button className="oka-btn" disabled={s < premio.pontos} onClick={confirmar}>
              Confirmar resgate
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Conteúdo do cupom aberto (QR grande + código + validade). */
function CupomAberto({ cupom, recemCriado }: { cupom: Cupom; recemCriado: boolean }) {
  const st = statusCupom(cupom);
  return (
    <div className="cupom-aberto">
      {recemCriado && (
        <div className="oka-aviso ok" style={{ marginBottom: 12 }}>
          Resgate feito! −{formatarPontos(cupom.pontosDebitados)} pontos.
        </div>
      )}
      <span className={`etiqueta ${st}`}>{ROTULO_STATUS[st]}</span>
      <h3 style={{ fontSize: 22, margin: "8px 0 6px" }}>{cupom.premioNome}</h3>
      {st === "ativo" ? (
        <>
          <div className="qr-grande">
            <QrCupom codigo={cupom.codigo} />
          </div>
          <span className="codigo">{cupom.codigo}</span>
          <p className="mudo" style={{ margin: "4px 0 0" }}>
            Mostre o QR ou diga o código no balcão.
            <br />
            Válido até {formatarData(cupom.expiraEm)} ({diasRestantes(cupom.expiraEm)}{" "}
            {diasRestantes(cupom.expiraEm) === 1 ? "dia" : "dias"})
          </p>
        </>
      ) : (
        <>
          <span className="codigo">{cupom.codigo}</span>
          <p className="mudo">
            {st === "usado" && cupom.usadoEm
              ? `Usado em ${formatarDataHora(cupom.usadoEm)}.`
              : `Expirou em ${formatarData(cupom.expiraEm)} sem uso. Os pontos não voltam.`}
          </p>
        </>
      )}
    </div>
  );
}

/** C4 Meus cupons */
function TelaCupons(props: { cliente: Cliente; abertoId: string | null; setAbertoId: (id: string | null) => void; recemCriadoId: string | null }) {
  const { state } = useStore();
  const [filtro, setFiltro] = useState<StatusCupom>("ativo");
  const doCliente = state.cupons
    .filter((c) => c.clienteId === props.cliente.id)
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  const contagem = (st: StatusCupom) => doCliente.filter((c) => statusCupom(c) === st).length;
  const lista = doCliente.filter((c) => statusCupom(c) === filtro);
  const aberto = state.cupons.find((c) => c.id === props.abertoId);

  return (
    <div>
      <h1 className="titulo-tela">Meus cupons</h1>
      <Abas
        itens={(["ativo", "usado", "expirado"] as const).map((st) => ({
          id: st,
          rotulo: `${ROTULO_STATUS[st]}s (${contagem(st)})`,
        }))}
        valor={filtro}
        aoMudar={setFiltro}
        rotulo="Situação dos cupons"
      />
      {lista.length === 0 && (
        <p className="oka-placeholder">
          {filtro === "ativo" ? "Nenhum cupom ativo. Escolha um prêmio na vitrine." : "Nada por aqui."}
        </p>
      )}
      {lista.map((c) => {
        const st = statusCupom(c);
        return (
          <button key={c.id} className={`cupom${st !== "ativo" ? " inativo" : ""}`} onClick={() => props.setAbertoId(c.id)}>
            <div className="qr-mini" style={{ opacity: st === "ativo" ? 1 : 0.25 }}>
              <QrCupom codigo={c.codigo} />
            </div>
            <div className="info">
              <span className={`etiqueta ${st}`}>{ROTULO_STATUS[st]}</span>
              <strong>{c.premioNome}</strong>
              <span className="codigo">{c.codigo}</span>
              <div className="mudo">
                {st === "ativo" && `Válido até ${formatarData(c.expiraEm)}`}
                {st === "usado" && c.usadoEm && `Usado em ${formatarData(c.usadoEm)}`}
                {st === "expirado" && `Expirou em ${formatarData(c.expiraEm)}`}
              </div>
            </div>
          </button>
        );
      })}

      {aberto && (
        <Modal titulo="Cupom" aoFechar={() => props.setAbertoId(null)}>
          <CupomAberto cupom={aberto} recemCriado={aberto.id === props.recemCriadoId} />
          <div className="acoes">
            <button className="oka-btn sec" onClick={() => props.setAbertoId(null)}>
              Fechar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** C2 Início */
function TelaInicio({ cliente, irPara }: { cliente: Cliente; irPara: (t: TelaCliente) => void }) {
  const { state } = useStore();
  const s = saldo(cliente.id, state.movimentos);
  const marco = proximoMarco(s);
  const disponiveis = state.premios.filter((p) => p.ativo && p.pontos <= s).length;

  return (
    <div className="pilha">
      <h1 className="titulo-tela">Olá, {cliente.nome.split(" ")[0]}</h1>
      <section className="oka-cartao" aria-label="Seu cartão Club OKA">
        <div className="club">Club OKA</div>
        <div className="slogan">Quem volta, faz parte da casa.</div>
        <div className="saldo">
          {formatarPontos(s)}
          <small>pontos</small>
        </div>
        <ReguaMarcos saldoAtual={s} />
      </section>
      <p className="oka-aviso ok">
        {marco === null
          ? "Você chegou ao topo da régua: pode escolher qualquer prêmio da vitrine."
          : `Faltam ${formatarPontos(marco - s)} pontos para o marco de ${formatarPontos(marco)}.`}
      </p>
      <button className="oka-btn bloco" onClick={() => irPara("premios")}>
        <Icone nome="presente" />
        Ver prêmios {disponiveis > 0 && `(${disponiveis} ${disponiveis === 1 ? "disponível" : "disponíveis"})`}
      </button>
      <button className="oka-btn sec bloco" onClick={() => irPara("historico")}>
        <Icone nome="lista" />
        Ver extrato
      </button>
    </div>
  );
}

/** C5 Histórico */
function TelaHistorico({ cliente }: { cliente: Cliente }) {
  const { state } = useStore();
  const movs = movimentosDoCliente(cliente.id, state.movimentos);
  return (
    <div>
      <h1 className="titulo-tela">Extrato</h1>
      <div className="oka-card linha entre" style={{ marginBottom: 14 }}>
        <span className="mudo">Saldo atual</span>
        <strong style={{ fontSize: 22 }}>{formatarPontos(saldo(cliente.id, state.movimentos))} pts</strong>
      </div>
      <div className="oka-card">
        {movs.length === 0 ? (
          <p className="mudo" style={{ margin: "8px 0" }}>
            Nenhum movimento ainda. Na próxima compra, informe seu telefone no balcão para ganhar pontos.
          </p>
        ) : (
          movs.map((m) => <LinhaMovimento key={m.id} m={m} />)
        )}
      </div>
    </div>
  );
}

const NAV_CLIENTE: { id: TelaCliente; rotulo: string; icone: NomeIcone }[] = [
  { id: "inicio", rotulo: "Início", icone: "casa" },
  { id: "premios", rotulo: "Prêmios", icone: "presente" },
  { id: "cupons", rotulo: "Cupons", icone: "cupom" },
  { id: "historico", rotulo: "Extrato", icone: "lista" },
];

function VisaoCliente(props: {
  clienteId: string | null;
  setClienteId: (id: string | null) => void;
  tela: TelaCliente;
  setTela: (t: TelaCliente) => void;
  cupomAberto: { id: string; recemCriado: boolean } | null;
  setCupomAberto: (c: { id: string; recemCriado: boolean } | null) => void;
}) {
  const { state } = useStore();
  const cliente = state.clientes.find((c) => c.id === props.clienteId) ?? null;

  return (
    <div className={cliente ? "com-nav" : undefined}>
      {/* Atalho da demo: simula "quem está logado", já que não há login real. */}
      <div className="campo-demo">
        <label htmlFor="demo-cliente">Demo · você é</label>
        <select
          id="demo-cliente"
          value={props.clienteId ?? ""}
          onChange={(e) => {
            props.setClienteId(e.target.value || null);
            props.setTela("inicio");
            props.setCupomAberto(null);
          }}
        >
          {state.clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
          <option value="">+ Novo cadastro</option>
        </select>
      </div>

      {!cliente && (
        <TelaCadastro
          aoEntrar={(id) => {
            props.setClienteId(id);
            props.setTela("inicio");
          }}
        />
      )}

      {cliente && (
        <>
          {props.tela === "inicio" && <TelaInicio cliente={cliente} irPara={props.setTela} />}
          {props.tela === "premios" && (
            <TelaPremios
              key={cliente.id}
              cliente={cliente}
              aoResgatar={(cupomId) => {
                // Depois do resgate, o cliente cai direto no cupom novo, já aberto.
                props.setCupomAberto({ id: cupomId, recemCriado: true });
                props.setTela("cupons");
              }}
            />
          )}
          {props.tela === "cupons" && (
            <TelaCupons
              key={cliente.id}
              cliente={cliente}
              abertoId={props.cupomAberto?.id ?? null}
              setAbertoId={(id) => props.setCupomAberto(id ? { id, recemCriado: false } : null)}
              recemCriadoId={props.cupomAberto?.recemCriado ? props.cupomAberto.id : null}
            />
          )}
          {props.tela === "historico" && <TelaHistorico cliente={cliente} />}

          <nav className="oka-nav-cliente" aria-label="Navegação do cliente">
            <div>
              {NAV_CLIENTE.map((n) => (
                <button
                  key={n.id}
                  aria-current={props.tela === n.id ? "page" : undefined}
                  onClick={() => props.setTela(n.id)}
                >
                  <Icone nome={n.icone} />
                  {n.rotulo}
                </button>
              ))}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

/* ============================================================
 * 9. TELAS DO ATENDENTE
 * ============================================================ */

type TelaAtendente = "compra" | "cupom";

/**
 * Busca do A1. Telefone completo → correspondência exata.
 * Telefone parcial (4+ dígitos) → telefones que contêm os dígitos.
 * Texto → nome, ignorando maiúsculas e acentos.
 */
export function buscarClientes(termo: string, clientes: Cliente[]) {
  const t = termo.trim();
  const digitos = t.replace(/\D/g, "");
  const pareceTelefone = /^[\d\s()+\-.]+$/.test(t);
  const telefone = normalizarTelefone(t);
  if (telefone) return { modo: "telefone" as const, telefone, resultados: clientes.filter((c) => c.telefone === telefone) };
  if (pareceTelefone) {
    if (digitos.length >= 10) return { modo: "telefone-invalido" as const, resultados: [] };
    if (digitos.length >= 4) return { modo: "parcial" as const, resultados: clientes.filter((c) => c.telefone.includes(digitos)) };
    return { modo: "vazio" as const, resultados: [] };
  }
  if (t.length < 2) return { modo: "vazio" as const, resultados: [] };
  const n = normalizarTexto(t);
  return { modo: "nome" as const, resultados: clientes.filter((c) => normalizarTexto(c.nome).includes(n)) };
}

/** A1 Registrar compra */
function TelaRegistrarCompra() {
  const { state, dispatch } = useStore();
  const [busca, setBusca] = useState("");
  const [escolhidoId, setEscolhidoId] = useState<string | null>(null);
  const [valorTexto, setValorTexto] = useState("");
  const [erroValor, setErroValor] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<{ opId: string; valor: number } | null>(null);
  const [conferiuValorAlto, setConferiuValorAlto] = useState(false);
  const [concluida, setConcluida] = useState<{ movId: string; clienteId: string } | null>(null);
  const campoValor = useRef<HTMLInputElement>(null);

  const r = buscarClientes(busca, state.clientes);
  // O cliente é derivado da busca a cada render: se o atendente editar o
  // telefone, o cliente "achado" some na hora, sem risco de lançar para a pessoa errada.
  const cliente =
    state.clientes.find((c) => c.id === escolhidoId) ??
    (r.modo === "telefone" && r.resultados.length === 1 ? r.resultados[0] : null);

  const valor = parseValor(valorTexto);
  const previa = valor !== null ? calcularPontos(valor, state.regras) : 0;

  function reiniciar() {
    setBusca("");
    setEscolhidoId(null);
    setValorTexto("");
    setErroValor(null);
    setConfirmando(null);
    setConferiuValorAlto(false);
    setConcluida(null);
  }

  function revisar() {
    if (!cliente) return;
    if (!valorTexto.trim()) return setErroValor("Informe o valor da compra. Sem valor não há pontos.");
    if (valor === null) return setErroValor("Valor inválido. Use, por exemplo, 47,90.");
    if (valor <= 0) return setErroValor("O valor precisa ser maior que zero.");
    if (previa <= 0) return setErroValor("Esse valor não gera nenhum ponto.");
    setErroValor(null);
    setConferiuValorAlto(false);
    setConfirmando({ opId: novoId("mov"), valor });
  }

  function confirmar() {
    if (!confirmando || !cliente) return;
    dispatch({
      tipo: "REGISTRAR_COMPRA",
      id: confirmando.opId,
      clienteId: cliente.id,
      valor: confirmando.valor,
      agora: new Date().toISOString(),
    });
    setConcluida({ movId: confirmando.opId, clienteId: cliente.id });
    setConfirmando(null);
  }

  /* ----- Tela de sucesso ----- */
  if (concluida) {
    const mov = state.movimentos.find((m) => m.id === concluida.movId);
    const quem = state.clientes.find((c) => c.id === concluida.clienteId);
    return (
      <div className="oka-card sucesso">
        <div className="selo-ok">
          <Icone nome="check" tamanho={32} />
        </div>
        <div className="grande">+{formatarPontos(mov?.pontos ?? 0)}</div>
        <p style={{ margin: "4px 0 2px" }}>
          pontos para <strong>{quem?.nome}</strong>
        </p>
        <p className="mudo" style={{ marginTop: 0 }}>
          Compra de {formatarMoeda(mov?.valorCompra ?? 0)} · novo saldo{" "}
          <strong>{formatarPontos(saldo(concluida.clienteId, state.movimentos))} pts</strong>
        </p>
        <button className="oka-btn bloco" onClick={reiniciar}>
          Registrar outra compra
        </button>
        <p className="mudo" style={{ marginTop: 14 }}>
          Lançou errado? Só o dono corrige, no painel: Clientes → ajuste de pontos.
        </p>
      </div>
    );
  }

  const valorAlto = confirmando !== null && confirmando.valor > state.regras.limiteConfirmacaoExtra;

  return (
    <div>
      <h1 className="titulo-tela">Registrar compra</h1>

      <div className="oka-campo">
        <label htmlFor="a1-busca">Telefone ou nome do cliente</label>
        <input
          id="a1-busca"
          value={busca}
          inputMode="search"
          autoComplete="off"
          placeholder="(91) 99999-0001 ou Marina"
          onChange={(e) => {
            setBusca(e.target.value);
            setEscolhidoId(null);
          }}
        />
      </div>

      {/* Avisos e resultados da busca */}
      {!cliente && r.modo === "telefone" && r.resultados.length === 0 && (
        <div className="oka-aviso erro" role="alert" style={{ marginBottom: 14 }}>
          <strong>Nenhuma conta com o telefone {formatarTelefone(r.telefone)}.</strong> Peça para o cliente criar a conta
          pelo QR do balcão e depois registre a compra.
        </div>
      )}
      {r.modo === "telefone-invalido" && (
        <div className="oka-aviso erro" role="alert" style={{ marginBottom: 14 }}>
          Telefone inválido. Confira o DDD e os dígitos.
        </div>
      )}
      {!cliente && (r.modo === "nome" || r.modo === "parcial") && (
        r.resultados.length === 0 ? (
          <div className="oka-aviso erro" role="alert" style={{ marginBottom: 14 }}>
            Nenhum cliente encontrado. Se ainda não tem conta, peça para criar pelo QR do balcão.
          </div>
        ) : (
          <div className="resultado-busca" aria-label="Clientes encontrados">
            {r.resultados.slice(0, 6).map((c) => (
              <button key={c.id} onClick={() => setEscolhidoId(c.id)}>
                <span>
                  <strong>{c.nome}</strong>
                  <br />
                  <span className="mudo">{formatarTelefone(c.telefone)}</span>
                </span>
                <span className="mudo">{formatarPontos(saldo(c.id, state.movimentos))} pts</span>
              </button>
            ))}
          </div>
        )
      )}

      {cliente && (
        <>
          <div className="cliente-achado">
            <div className="linha entre">
              <div>
                <div className="nome">{cliente.nome}</div>
                <div className="mudo">{formatarTelefone(cliente.telefone)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="mudo">Saldo</div>
                <strong>{formatarPontos(saldo(cliente.id, state.movimentos))} pts</strong>
              </div>
            </div>
          </div>

          <div className="oka-campo">
            <label htmlFor="a1-valor">Valor da compra (R$)</label>
            <input
              id="a1-valor"
              ref={campoValor}
              value={valorTexto}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              onChange={(e) => {
                setValorTexto(e.target.value);
                setErroValor(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && revisar()}
            />
            {erroValor && (
              <span className="erro" role="alert">
                {erroValor}
              </span>
            )}
          </div>
          {previa > 0 && (
            <p className="previa-pontos">
              Vai creditar {formatarPontos(previa)} {previa === 1 ? "ponto" : "pontos"}
            </p>
          )}
          <button className="oka-btn bloco" onClick={revisar}>
            Revisar compra
          </button>
        </>
      )}

      {/* Modal de confirmação: último ponto para pegar erro de digitação */}
      {confirmando && cliente && (
        <Modal titulo="Confirme a venda" aoFechar={() => setConfirmando(null)}>
          <dl className="resumo">
            <div>
              <dt>Cliente</dt>
              <dd>{cliente.nome}</dd>
            </div>
            <div>
              <dt>Telefone</dt>
              <dd>{formatarTelefone(cliente.telefone)}</dd>
            </div>
            <div>
              <dt>Valor</dt>
              <dd className="destaque">{formatarMoeda(confirmando.valor)}</dd>
            </div>
            <div>
              <dt>Pontos</dt>
              <dd>+{formatarPontos(calcularPontos(confirmando.valor, state.regras))}</dd>
            </div>
            <div>
              <dt>Saldo depois</dt>
              <dd>
                {formatarPontos(saldo(cliente.id, state.movimentos) + calcularPontos(confirmando.valor, state.regras))} pts
              </dd>
            </div>
          </dl>
          {valorAlto && (
            <>
              <div className="oka-aviso atencao" style={{ marginTop: 12 }}>
                <strong>Valor acima de {formatarMoeda(state.regras.limiteConfirmacaoExtra)}.</strong> Confira com o
                cliente antes de confirmar.
              </div>
              <label className="check-extra">
                <input type="checkbox" checked={conferiuValorAlto} onChange={(e) => setConferiuValorAlto(e.target.checked)} />
                Conferi o valor com o cliente
              </label>
            </>
          )}
          <div className="acoes">
            <button
              className="oka-btn sec"
              onClick={() => {
                setConfirmando(null);
                setTimeout(() => campoValor.current?.focus(), 0);
              }}
            >
              Corrigir
            </button>
            <button className="oka-btn" disabled={valorAlto && !conferiuValorAlto} onClick={confirmar}>
              Confirmar venda
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** A2 Validar cupom */
function TelaValidarCupom() {
  const { state, dispatch } = useStore();
  const [codigoTexto, setCodigoTexto] = useState("");
  const [consultado, setConsultado] = useState<string | null>(null);
  const [usadoAgoraId, setUsadoAgoraId] = useState<string | null>(null);
  const [semAtivos, setSemAtivos] = useState(false);

  // O resultado é lido do estado a cada render: se o cupom mudar (usado, expirado), a tela acompanha.
  const cupom = consultado ? state.cupons.find((c) => c.codigo === consultado) : undefined;
  const dono = cupom ? state.clientes.find((c) => c.id === cupom.clienteId) : undefined;
  const st = cupom ? statusCupom(cupom) : null;

  function verificar(texto: string) {
    const cod = normalizarCodigo(texto);
    setUsadoAgoraId(null);
    setSemAtivos(false);
    setConsultado(cod || null);
  }

  /** Sem câmera: "lê" o cupom ativo gerado mais recentemente. */
  function simularLeitura() {
    const ativo = [...state.cupons]
      .filter((c) => statusCupom(c) === "ativo")
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))[0];
    if (!ativo) {
      setConsultado(null);
      setSemAtivos(true);
      return;
    }
    setCodigoTexto(ativo.codigo);
    verificar(ativo.codigo);
  }

  function confirmarUso() {
    if (!cupom) return;
    dispatch({ tipo: "USAR_CUPOM", cupomId: cupom.id, agora: new Date().toISOString() });
    setUsadoAgoraId(cupom.id);
  }

  function novaLeitura() {
    setCodigoTexto("");
    setConsultado(null);
    setUsadoAgoraId(null);
  }

  return (
    <div>
      <h1 className="titulo-tela">Validar cupom</h1>
      <button className="oka-btn sec bloco" onClick={simularLeitura} style={{ marginBottom: 16 }}>
        <Icone nome="qr" />
        Simular leitura de QR
      </button>
      <div className="oka-campo">
        <label htmlFor="a2-codigo">Ou digite o código</label>
        <input
          id="a2-codigo"
          value={codigoTexto}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="OKA-7K3P"
          className="codigo"
          onChange={(e) => {
            setCodigoTexto(e.target.value);
            setConsultado(null); // resultado antigo some ao editar
            setSemAtivos(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && verificar(codigoTexto)}
        />
      </div>
      <button className="oka-btn bloco" disabled={!codigoTexto.trim()} onClick={() => verificar(codigoTexto)}>
        Verificar código
      </button>

      <div style={{ marginTop: 18 }} aria-live="polite">
        {semAtivos && <div className="oka-aviso atencao">Nenhum cupom ativo para simular. Faça um resgate na visão Cliente.</div>}

        {consultado && !cupom && (
          <div className="oka-aviso erro" role="alert">
            <strong>Código {consultado} não encontrado.</strong> Confira as letras e os números com o cliente.
          </div>
        )}

        {cupom && st && (
          <div className="oka-card pilha">
            {usadoAgoraId === cupom.id ? (
              <div className="sucesso" style={{ padding: "8px 0" }}>
                <div className="selo-ok">
                  <Icone nome="check" tamanho={32} />
                </div>
                <h2 style={{ fontSize: 22 }}>Cupom usado</h2>
                <p style={{ margin: "6px 0 0" }}>
                  Entregue: <strong>{cupom.premioNome}</strong>
                </p>
              </div>
            ) : (
              <div className="linha entre">
                <span className={`etiqueta ${st}`}>{st === "ativo" ? "Válido" : ROTULO_STATUS[st]}</span>
                <span className="codigo">{cupom.codigo}</span>
              </div>
            )}
            <dl className="resumo" style={{ background: "var(--creme-claro)" }}>
              <div>
                <dt>Cliente</dt>
                <dd>{dono?.nome ?? "—"}</dd>
              </div>
              <div>
                <dt>Telefone</dt>
                <dd>{dono ? formatarTelefone(dono.telefone) : "—"}</dd>
              </div>
              <div>
                <dt>Prêmio</dt>
                <dd>{cupom.premioNome}</dd>
              </div>
              <div>
                <dt>Validade</dt>
                <dd>{formatarData(cupom.expiraEm)}</dd>
              </div>
            </dl>

            {st === "ativo" && (
              <button className="oka-btn bloco" onClick={confirmarUso}>
                Confirmar uso e entregar
              </button>
            )}
            {st === "usado" && usadoAgoraId !== cupom.id && (
              <div className="oka-aviso erro" role="alert">
                <strong>Cupom já usado</strong>
                {cupom.usadoEm && ` em ${formatarDataHora(cupom.usadoEm)}`}. Não entregue o prêmio de novo.
              </div>
            )}
            {st === "expirado" && (
              <div className="oka-aviso erro" role="alert">
                <strong>Cupom expirado</strong> em {formatarData(cupom.expiraEm)}. Não pode ser usado, e os pontos não
                voltam.
              </div>
            )}
            {st !== "ativo" && (
              <button className="oka-btn sec bloco" onClick={novaLeitura}>
                Validar outro cupom
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const ABAS_ATENDENTE = [
  { id: "compra", rotulo: "Registrar compra" },
  { id: "cupom", rotulo: "Validar cupom" },
] as const;

function VisaoAtendente({ tela, setTela }: { tela: TelaAtendente; setTela: (t: TelaAtendente) => void }) {
  return (
    <div>
      <Abas itens={ABAS_ATENDENTE} valor={tela} aoMudar={setTela} rotulo="Funções do atendente" />
      {tela === "compra" && <TelaRegistrarCompra />}
      {tela === "cupom" && <TelaValidarCupom />}
    </div>
  );
}

/* ============================================================
 * 10. TELAS DO DONO
 * ============================================================ */

type TelaDono = "dashboard" | "clientes" | "premios" | "regras";

/** Gráfico de barras de compras por dia (HTML puro: nítido e responsivo). */
function GraficoComprasPorDia({ dias }: { dias: Dashboard["porDia"] }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(...dias.map((d) => d.compras), 1);
  const passo = max <= 10 ? 5 : max <= 20 ? 5 : 10;
  const topo = Math.ceil(max / passo) * passo;
  const linhas = Array.from({ length: topo / passo + 1 }, (_, i) => i * passo);
  const cadaRotulo = dias.length > 10 ? 5 : 1;
  const nomeDia = (d: Date) => d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const atual = sel !== null ? dias[sel] : null;

  return (
    <div>
      <div className="grafico-leitura" aria-live="polite">
        {atual ? (
          <>
            <strong>{atual.compras} compras</strong> · {nomeDia(atual.data)} · {formatarMoeda(atual.receita)}
          </>
        ) : (
          "Passe o mouse ou toque numa barra para ver o dia."
        )}
      </div>
      <div className="grafico" onPointerLeave={() => setSel(null)}>
        {linhas.map((v) => (
          <div key={v} className="grade" style={{ bottom: `${(v / topo) * 100}%` }}>
            <span>{v}</span>
          </div>
        ))}
        <div className="barras">
          {dias.map((d, i) => (
            <button
              key={i}
              className="barra"
              aria-pressed={sel === i}
              aria-label={`${nomeDia(d.data)}: ${d.compras} compras`}
              onPointerEnter={() => setSel(i)}
              onFocus={() => setSel(i)}
              onClick={() => setSel(i)}
            >
              <i style={{ height: `${(d.compras / topo) * 100}%` }} />
            </button>
          ))}
        </div>
      </div>
      <div className="eixo-x" aria-hidden="true">
        {dias.map((d, i) => (
          <span key={i}>{(dias.length - 1 - i) % cadaRotulo === 0 ? `${d.data.getDate()}/${d.data.getMonth() + 1}` : ""}</span>
        ))}
      </div>
      <details style={{ marginTop: 8 }}>
        <summary>Ver como tabela</summary>
        <table className="tabela-simples">
          <thead>
            <tr>
              <th>Dia</th>
              <th className="num">Compras</th>
              <th className="num">Faturamento</th>
            </tr>
          </thead>
          <tbody>
            {dias.map((d, i) => (
              <tr key={i}>
                <td>{nomeDia(d.data)}</td>
                <td className="num">{d.compras}</td>
                <td className="num">{formatarMoeda(d.receita)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** D1 Dashboard */
function TelaDashboard() {
  const { state } = useStore();
  const [periodo, setPeriodo] = useState<Periodo>(30);
  const d = calcularDashboard(state, periodo);
  const rotuloPeriodo = periodo === 30 ? "nos últimos 30 dias" : "nos últimos 7 dias";

  return (
    <div>
      <div className="linha entre" style={{ flexWrap: "wrap", marginBottom: 12 }}>
        <h1 className="titulo-tela" style={{ margin: 0 }}>
          Dashboard
        </h1>
        <div className="segmentado" role="group" aria-label="Período" style={{ minWidth: 200 }}>
          {([7, 30] as const).map((p) => (
            <button key={p} aria-pressed={periodo === p} onClick={() => setPeriodo(p)}>
              {p} dias
            </button>
          ))}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <span>Clientes cadastrados</span>
          <strong>{formatarPontos(d.totalClientes)}</strong>
          <small>total</small>
        </div>
        <div className="kpi">
          <span>Novos clientes</span>
          <strong>{formatarPontos(d.novos)}</strong>
          <small>{rotuloPeriodo}</small>
        </div>
        <div className="kpi">
          <span>Pontos emitidos</span>
          <strong>{formatarPontos(d.pontosEmitidos)}</strong>
          <small>{rotuloPeriodo}</small>
        </div>
        <div className="kpi">
          <span>Pontos resgatados</span>
          <strong>{formatarPontos(d.pontosResgatados)}</strong>
          <small>{rotuloPeriodo}</small>
        </div>
        <div className="kpi">
          <span>Ticket médio</span>
          <strong>{formatarMoeda(d.ticketMedio)}</strong>
          <small>{rotuloPeriodo}</small>
        </div>
        <div className="kpi">
          <span>Taxa de retorno</span>
          <strong>{d.taxaRetorno}%</strong>
          <small>voltaram em 30 dias</small>
        </div>
      </div>

      <div className="dash-grade">
        <section className="oka-card">
          <h2 style={{ fontSize: 20 }}>Compras por dia</h2>
          <GraficoComprasPorDia key={periodo} dias={d.porDia} />
        </section>
        <section className="oka-card">
          <h2 style={{ fontSize: 20, marginBottom: 6 }}>Clientes que mais gastam</h2>
          <p className="ajuda" style={{ marginTop: 0 }}>Entre os clientes da demo, {rotuloPeriodo}.</p>
          {d.topClientes.length === 0 ? (
            <p className="mudo">Nenhuma compra no período.</p>
          ) : (
            <table className="tabela-simples">
              <tbody>
                {d.topClientes.map((t, i) => (
                  <tr key={t.cliente.id}>
                    <td style={{ width: 22, color: "var(--marrom)", fontWeight: 700 }}>{i + 1}</td>
                    <td>
                      {t.cliente.nome}
                      <div className="ajuda">
                        {t.compras} {t.compras === 1 ? "compra" : "compras"}
                      </div>
                    </td>
                    <td className="num">
                      <strong>{formatarMoeda(t.gasto)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <p className="ajuda" style={{ marginTop: 14 }}>
        Números fictícios para a demo, somados ao que for feito durante a apresentação.
      </p>
    </div>
  );
}

/** Formulário de ajuste manual de pontos (corrige lançamentos errados). */
function FormAjuste({ cliente, aoConcluir }: { cliente: Cliente; aoConcluir: () => void }) {
  const { state, dispatch } = useStore();
  const [sinal, setSinal] = useState<1 | -1>(-1);
  const [pontosTexto, setPontosTexto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [opId] = useState(() => novoId("aj"));
  const atual = saldo(cliente.id, state.movimentos);
  const n = /^\d+$/.test(pontosTexto.trim()) ? Number(pontosTexto.trim()) : NaN;
  const depois = Number.isFinite(n) ? atual + sinal * n : null;

  function lancar() {
    if (!Number.isInteger(n) || n <= 0) return setErro("Informe uma quantidade inteira de pontos.");
    if (!motivo.trim()) return setErro("Informe o motivo. Ele aparece no extrato do cliente.");
    if (depois !== null && depois < 0) return setErro(`O saldo não pode ficar negativo (saldo atual: ${formatarPontos(atual)}).`);
    dispatch({ tipo: "AJUSTAR_PONTOS", id: opId, clienteId: cliente.id, pontos: sinal * n, motivo, agora: new Date().toISOString() });
    aoConcluir();
  }

  return (
    <div className="oka-card" style={{ background: "var(--creme)", marginTop: 12 }}>
      <h3 style={{ fontSize: 18, marginBottom: 10 }}>Ajustar pontos</h3>
      <div className="segmentado" role="group" aria-label="Tipo de ajuste" style={{ marginBottom: 12 }}>
        <button aria-pressed={sinal === -1} onClick={() => setSinal(-1)}>
          Remover
        </button>
        <button aria-pressed={sinal === 1} onClick={() => setSinal(1)}>
          Adicionar
        </button>
      </div>
      <div className="oka-campo">
        <label htmlFor="aj-pts">Pontos</label>
        <input id="aj-pts" inputMode="numeric" value={pontosTexto} onChange={(e) => { setPontosTexto(e.target.value); setErro(null); }} />
      </div>
      <div className="oka-campo">
        <label htmlFor="aj-motivo">Motivo</label>
        <input
          id="aj-motivo"
          value={motivo}
          placeholder="Ex.: compra lançada como R$ 480 em vez de R$ 48"
          onChange={(e) => { setMotivo(e.target.value); setErro(null); }}
        />
      </div>
      {depois !== null && n > 0 && (
        <p className="mudo" style={{ marginTop: -4 }}>
          Saldo: {formatarPontos(atual)} → <strong>{formatarPontos(depois)} pts</strong>
        </p>
      )}
      {erro && <div className="oka-aviso erro" role="alert" style={{ marginBottom: 10 }}>{erro}</div>}
      <button className="oka-btn bloco" onClick={lancar}>
        Lançar ajuste
      </button>
    </div>
  );
}

function ultimaCompra(clienteId: string, movimentos: Movimento[]): string | null {
  return movimentos
    .filter((m) => m.clienteId === clienteId && m.tipo === "compra")
    .reduce<string | null>((max, m) => (max === null || m.data > max ? m.data : max), null);
}

/** D2 Clientes */
function TelaClientesDono() {
  const { state } = useStore();
  const [busca, setBusca] = useState("");
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [ajustando, setAjustando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const termo = normalizarTexto(busca);
  const digitos = busca.replace(/\D/g, "");
  const linhas = state.clientes
    .filter((c) => !termo || normalizarTexto(c.nome).includes(termo) || (digitos.length >= 3 && c.telefone.includes(digitos)) || c.email.includes(termo))
    .map((c) => ({ c, saldo: saldo(c.id, state.movimentos), ultima: ultimaCompra(c.id, state.movimentos) }))
    .sort((a, b) => (b.ultima ?? b.c.criadoEm).localeCompare(a.ultima ?? a.c.criadoEm));
  const aberto = state.clientes.find((c) => c.id === abertoId);

  function fechar() {
    setAbertoId(null);
    setAjustando(false);
    setAviso(null);
  }

  return (
    <div>
      <h1 className="titulo-tela">Clientes</h1>
      <div className="oka-campo">
        <label htmlFor="d2-busca">Buscar por nome, telefone ou e-mail</label>
        <input id="d2-busca" value={busca} inputMode="search" onChange={(e) => setBusca(e.target.value)} />
      </div>
      <div className="cabecalho-lista" aria-hidden="true">
        <span>Cliente</span>
        <span>Telefone</span>
        <span>Saldo</span>
        <span>Última compra</span>
      </div>
      <div className="lista-linhas">
        {linhas.length === 0 && <p className="mudo">Nenhum cliente encontrado.</p>}
        {linhas.map(({ c, saldo: sd, ultima }) => (
          <button key={c.id} className="linha-item cliente" onClick={() => setAbertoId(c.id)}>
            <strong>{c.nome}</strong>
            <span className="sec-info">{formatarTelefone(c.telefone)}</span>
            <span>
              <strong>{formatarPontos(sd)}</strong> pts
            </span>
            <span className="sec-info">{ultima ? formatarData(ultima) : "Sem compras"}</span>
          </button>
        ))}
      </div>

      {aberto && (
        <Modal titulo={aberto.nome} aoFechar={fechar}>
          <dl className="resumo">
            <div>
              <dt>Telefone</dt>
              <dd>{formatarTelefone(aberto.telefone)}</dd>
            </div>
            <div>
              <dt>E-mail</dt>
              <dd style={{ overflowWrap: "anywhere" }}>{aberto.email}</dd>
            </div>
            <div>
              <dt>Cliente desde</dt>
              <dd>{formatarData(aberto.criadoEm)}</dd>
            </div>
            <div>
              <dt>Saldo</dt>
              <dd className="destaque">{formatarPontos(saldo(aberto.id, state.movimentos))} pts</dd>
            </div>
          </dl>
          {aviso && <div className="oka-aviso ok" style={{ marginTop: 12 }}>{aviso}</div>}
          {ajustando ? (
            <FormAjuste
              cliente={aberto}
              aoConcluir={() => {
                setAjustando(false);
                setAviso("Ajuste lançado. Ele já aparece no extrato do cliente.");
              }}
            />
          ) : (
            <button className="oka-btn sec bloco" style={{ marginTop: 12 }} onClick={() => { setAjustando(true); setAviso(null); }}>
              <Icone nome="ajustes" />
              Ajustar pontos
            </button>
          )}
          <h3 className="subtitulo">Extrato completo</h3>
          <div className="oka-card" style={{ padding: "4px 14px" }}>
            {movimentosDoCliente(aberto.id, state.movimentos).map((m) => (
              <LinhaMovimento key={m.id} m={m} />
            ))}
            {movimentosDoCliente(aberto.id, state.movimentos).length === 0 && <p className="mudo">Sem movimentos.</p>}
          </div>
          <div className="acoes">
            <button className="oka-btn sec" onClick={fechar}>
              Fechar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const CATEGORIAS: { id: CategoriaPremio; rotulo: string }[] = [
  { id: "cafe-gelado", rotulo: "Café gelado" },
  { id: "cafe", rotulo: "Café" },
  { id: "salgado", rotulo: "Salgado" },
  { id: "doce", rotulo: "Doce" },
  { id: "combo", rotulo: "Combo" },
];

/** Formulário de criar/editar prêmio. */
function FormPremio({ inicial, aoFechar }: { inicial: Premio | null; aoFechar: () => void }) {
  const { state, dispatch } = useStore();
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [categoria, setCategoria] = useState<CategoriaPremio>(inicial?.categoria ?? "cafe");
  const [pontosTexto, setPontosTexto] = useState(inicial ? String(inicial.pontos) : "");
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [erro, setErro] = useState<string | null>(null);
  const pontos = /^\d+$/.test(pontosTexto.trim()) ? Number(pontosTexto.trim()) : NaN;
  const faixa = Number.isFinite(pontos) && pontos > 0 ? FAIXAS.find((f) => f.id === faixaDe(pontos)) : undefined;

  function salvar() {
    const n = nome.trim().replace(/\s+/g, " ");
    if (!n) return setErro("Informe o nome do prêmio.");
    if (state.premios.some((p) => p.id !== inicial?.id && normalizarTexto(p.nome) === normalizarTexto(n)))
      return setErro("Já existe um prêmio com esse nome.");
    if (!Number.isInteger(pontos) || pontos <= 0) return setErro("Os pontos precisam ser um número inteiro maior que zero.");
    dispatch({
      tipo: "SALVAR_PREMIO",
      premio: { id: inicial?.id ?? novoId("p"), nome: n, descricao: descricao.trim() || undefined, categoria, pontos, ativo },
    });
    aoFechar();
  }

  return (
    <Modal titulo={inicial ? "Editar prêmio" : "Novo prêmio"} aoFechar={aoFechar}>
      <div className="oka-campo">
        <label htmlFor="pr-nome">Nome</label>
        <input id="pr-nome" value={nome} onChange={(e) => { setNome(e.target.value); setErro(null); }} />
      </div>
      <div className="oka-campo">
        <label htmlFor="pr-desc">Descrição (opcional)</label>
        <input id="pr-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
      </div>
      <div className="oka-campo">
        <label htmlFor="pr-cat">Ícone</label>
        <select id="pr-cat" value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaPremio)}>
          {CATEGORIAS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.rotulo}
            </option>
          ))}
        </select>
      </div>
      <div className="oka-campo">
        <label htmlFor="pr-pts">Pontos</label>
        <input id="pr-pts" inputMode="numeric" value={pontosTexto} onChange={(e) => { setPontosTexto(e.target.value); setErro(null); }} />
        {faixa && <span className="ajuda">Aparece na aba “{faixa.rotulo}” da vitrine.</span>}
        {inicial && Number.isFinite(pontos) && pontos !== inicial.pontos && (
          <span className="ajuda">Cupons já emitidos mantêm o valor antigo.</span>
        )}
      </div>
      <label className="check-extra">
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
        Ativo (aparece na vitrine do cliente)
      </label>
      {erro && <div className="oka-aviso erro" role="alert" style={{ marginTop: 10 }}>{erro}</div>}
      <div className="acoes">
        <button className="oka-btn sec" onClick={aoFechar}>
          Cancelar
        </button>
        <button className="oka-btn" onClick={salvar}>
          Salvar
        </button>
      </div>
    </Modal>
  );
}

/** D3 Prêmios */
function TelaPremiosDono() {
  const { state, dispatch } = useStore();
  const [editando, setEditando] = useState<Premio | "novo" | null>(null);
  const lista = [...state.premios].sort((a, b) => a.pontos - b.pontos);
  const ativos = lista.filter((p) => p.ativo).length;

  return (
    <div>
      <div className="linha entre" style={{ marginBottom: 12 }}>
        <h1 className="titulo-tela" style={{ margin: 0 }}>
          Prêmios
        </h1>
        <button className="oka-btn" onClick={() => setEditando("novo")}>
          <Icone nome="mais" />
          Novo
        </button>
      </div>
      <p className="ajuda" style={{ marginTop: 0 }}>
        {ativos} de {lista.length} ativos na vitrine. Referência usada: ~19 pontos por R$ 1 do preço.
      </p>
      <div className="lista-linhas">
        {lista.map((p) => (
          <div key={p.id} className={`premio-linha${p.ativo ? "" : " inativo"}`}>
            <div className="arte-mini">
              <Icone nome={p.categoria} />
            </div>
            <div className="meio">
              <strong>{p.nome}</strong>
              <div className="ajuda">
                {formatarPontos(p.pontos)} pts ·{" "}
                <span style={{ whiteSpace: "nowrap" }}>{FAIXAS.find((f) => f.id === faixaDe(p.pontos))?.rotulo}</span>
                {!p.ativo && " · inativo"}
              </div>
            </div>
            <label className="interruptor" title={p.ativo ? "Desativar" : "Ativar"}>
              <input
                type="checkbox"
                checked={p.ativo}
                aria-label={`${p.nome} ativo`}
                onChange={(e) => dispatch({ tipo: "SALVAR_PREMIO", premio: { ...p, ativo: e.target.checked } })}
              />
              <span />
            </label>
            <button className="btn-icone" aria-label={`Editar ${p.nome}`} title="Editar" onClick={() => setEditando(p)}>
              <Icone nome="lapis" />
            </button>
          </div>
        ))}
      </div>
      {editando && <FormPremio inicial={editando === "novo" ? null : editando} aoFechar={() => setEditando(null)} />}
    </div>
  );
}

/** D4 Regras */
function TelaRegras() {
  const { state, dispatch } = useStore();
  const [pprTexto, setPprTexto] = useState(String(state.regras.pontosPorReal).replace(".", ","));
  const [validade, setValidade] = useState(state.regras.validadeCupomDias);
  const [limiteTexto, setLimiteTexto] = useState(String(state.regras.limiteConfirmacaoExtra).replace(".", ","));
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const ppr = parseValor(pprTexto);
  const limite = parseValor(limiteTexto);
  const rascunho: Regras | null =
    ppr !== null && ppr > 0 && limite !== null && limite > 0
      ? { pontosPorReal: ppr, validadeCupomDias: validade, limiteConfirmacaoExtra: limite }
      : null;
  const mudou =
    !rascunho ||
    rascunho.pontosPorReal !== state.regras.pontosPorReal ||
    rascunho.validadeCupomDias !== state.regras.validadeCupomDias ||
    rascunho.limiteConfirmacaoExtra !== state.regras.limiteConfirmacaoExtra;

  function salvar() {
    if (ppr === null || ppr <= 0 || ppr > 10) return setErro("Pontos por real: use um número entre 0,1 e 10.");
    if (limite === null || limite <= 0) return setErro("Limite para confirmação extra: informe um valor em reais.");
    dispatch({ tipo: "ATUALIZAR_REGRAS", regras: { pontosPorReal: ppr, validadeCupomDias: validade, limiteConfirmacaoExtra: limite } });
    setErro(null);
    setSalvo(true);
  }

  const tocar = () => {
    setSalvo(false);
    setErro(null);
  };

  return (
    <div style={{ maxWidth: 520 }}>
      <h1 className="titulo-tela">Regras</h1>
      <div className="oka-card">
        <div className="oka-campo">
          <label htmlFor="d4-ppr">Pontos por R$ 1 gasto</label>
          <input id="d4-ppr" inputMode="decimal" value={pprTexto} onChange={(e) => { setPprTexto(e.target.value); tocar(); }} />
          <span className="ajuda">
            {rascunho
              ? `Exemplo: compra de R$ 50,00 gera ${formatarPontos(calcularPontos(50, rascunho))} pontos. Vale para as próximas compras.`
              : "Ex.: 1 ou 1,5"}
          </span>
        </div>
        <div className="oka-campo">
          <label htmlFor="d4-val">Validade do cupom</label>
          <select id="d4-val" value={validade} onChange={(e) => { setValidade(Number(e.target.value)); tocar(); }}>
            {Array.from({ length: VALIDADE_MAX - VALIDADE_MIN + 1 }, (_, i) => VALIDADE_MIN + i).map((d) => (
              <option key={d} value={d}>
                {d} dias
              </option>
            ))}
          </select>
          <span className="ajuda">Vale para cupons novos. Os já emitidos mantêm a data original.</span>
        </div>
        <div className="oka-campo">
          <label htmlFor="d4-lim">Pedir confirmação extra acima de (R$)</label>
          <input id="d4-lim" inputMode="decimal" value={limiteTexto} onChange={(e) => { setLimiteTexto(e.target.value); tocar(); }} />
          <span className="ajuda">Evita erro de digitação em compras de valor alto.</span>
        </div>
        <div className="oka-campo">
          <label>Cupom expirado sem uso</label>
          <div className="oka-aviso atencao">Os pontos se perdem (regra definida para a demo).</div>
        </div>
        {erro && <div className="oka-aviso erro" role="alert" style={{ marginBottom: 12 }}>{erro}</div>}
        {salvo && <div className="oka-aviso ok" role="status" style={{ marginBottom: 12 }}>Regras salvas.</div>}
        <button className="oka-btn bloco" disabled={!mudou} onClick={salvar}>
          Salvar regras
        </button>
      </div>
    </div>
  );
}

const ABAS_DONO = [
  { id: "dashboard", rotulo: "Dashboard" },
  { id: "clientes", rotulo: "Clientes" },
  { id: "premios", rotulo: "Prêmios" },
  { id: "regras", rotulo: "Regras" },
] as const;

function VisaoDono({ tela, setTela }: { tela: TelaDono; setTela: (t: TelaDono) => void }) {
  return (
    <div>
      <Abas itens={ABAS_DONO} valor={tela} aoMudar={setTela} rotulo="Seções do painel" />
      {tela === "dashboard" && <TelaDashboard />}
      {tela === "clientes" && <TelaClientesDono />}
      {tela === "premios" && <TelaPremiosDono />}
      {tela === "regras" && <TelaRegras />}
    </div>
  );
}

/* ============================================================
 * 11. APP
 * ============================================================
 * Estado de navegação fica aqui (e não dentro de cada visão) para que trocar
 * de Cliente para Atendente e voltar mantenha a tela e o cliente da demo.
 */

type Visao = "cliente" | "atendente" | "dono";

const VISOES: { id: Visao; rotulo: string }[] = [
  { id: "cliente", rotulo: "Cliente" },
  { id: "atendente", rotulo: "Atendente" },
  { id: "dono", rotulo: "Dono" },
];

export default function App() {
  const [visao, setVisao] = useState<Visao>("cliente");
  const [clienteId, setClienteId] = useState<string | null>("c_marina");
  const [telaCliente, setTelaCliente] = useState<TelaCliente>("inicio");
  const [telaAtendente, setTelaAtendente] = useState<TelaAtendente>("compra");
  // Cupom aberto mora no App: o apresentador troca para o Atendente, valida,
  // volta para o Cliente e vê o mesmo cupom já como "Usado".
  const [cupomAberto, setCupomAberto] = useState<{ id: string; recemCriado: boolean } | null>(null);
  const [telaDono, setTelaDono] = useState<TelaDono>("dashboard");

  return (
    <StoreProvider>
      <style>{CSS}</style>
      <div className="oka">
        <header className="oka-topo">
          <Marca />
          <nav className="oka-seletor" aria-label="Trocar visão da demo">
            {VISOES.map((v) => (
              <button key={v.id} aria-pressed={visao === v.id} onClick={() => setVisao(v.id)}>
                {v.rotulo}
              </button>
            ))}
          </nav>
        </header>
        <main className={`oka-conteudo${visao === "dono" ? " largo" : ""}`}>
          {visao === "cliente" && (
            <VisaoCliente
              clienteId={clienteId}
              setClienteId={setClienteId}
              tela={telaCliente}
              setTela={setTelaCliente}
              cupomAberto={cupomAberto}
              setCupomAberto={setCupomAberto}
            />
          )}
          {visao === "atendente" && <VisaoAtendente tela={telaAtendente} setTela={setTelaAtendente} />}
          {visao === "dono" && <VisaoDono tela={telaDono} setTela={setTelaDono} />}
        </main>
      </div>
    </StoreProvider>
  );
}

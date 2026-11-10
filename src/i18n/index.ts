import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { applyDocumentLanguage, getInitialLanguage } from './language';
import { applyArabicGlossary } from '../config/i18n';
import frCommon from './fr/common.json';
import frNav from './fr/nav.json';
import frAuth from './fr/auth.json';
import frPos from './fr/pos.json';
import frProducts from './fr/products.json';
import frSales from './fr/sales.json';
import frInvoices from './fr/invoices.json';
import frClients from './fr/clients.json';
import frRepairs from './fr/repairs.json';
import frExpenses from './fr/expenses.json';
import frReports from './fr/reports.json';
import frSettings from './fr/settings.json';
import frUsers from './fr/users.json';
import frDashboard from './fr/dashboard.json';
import frNotes from './fr/notes.json';
import frCashSession from './fr/cashSession.json';
import frStatistics from './fr/statistics.json';
import arCommon from './ar/common.json';
import arNav from './ar/nav.json';
import arAuth from './ar/auth.json';
import arPos from './ar/pos.json';
import arProducts from './ar/products.json';
import arSales from './ar/sales.json';
import arInvoices from './ar/invoices.json';
import arClients from './ar/clients.json';
import arRepairs from './ar/repairs.json';
import arExpenses from './ar/expenses.json';
import arReports from './ar/reports.json';
import arSettings from './ar/settings.json';
import arUsers from './ar/users.json';
import arDashboard from './ar/dashboard.json';
import arNotes from './ar/notes.json';
import arCashSession from './ar/cashSession.json';
import arStatistics from './ar/statistics.json';

const namespaces = [
  'common', 'nav', 'auth', 'pos', 'products', 'sales', 'invoices', 'clients',
  'repairs', 'expenses', 'reports', 'settings', 'users', 'dashboard', 'notes', 'cashSession', 'statistics',
];

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      fr: {
        common: frCommon, nav: frNav, auth: frAuth, pos: frPos, products: frProducts,
        sales: frSales, invoices: frInvoices, clients: frClients, repairs: frRepairs,
        expenses: frExpenses, reports: frReports, settings: frSettings, users: frUsers,
        dashboard: frDashboard, notes: frNotes, cashSession: frCashSession, statistics: frStatistics,
      },
      ar: {
        common: applyArabicGlossary(arCommon), nav: applyArabicGlossary(arNav),
        auth: applyArabicGlossary(arAuth), pos: applyArabicGlossary(arPos),
        products: applyArabicGlossary(arProducts), sales: applyArabicGlossary(arSales),
        invoices: applyArabicGlossary(arInvoices), clients: applyArabicGlossary(arClients),
        repairs: applyArabicGlossary(arRepairs), expenses: applyArabicGlossary(arExpenses),
        reports: applyArabicGlossary(arReports), settings: applyArabicGlossary(arSettings),
        users: applyArabicGlossary(arUsers), dashboard: applyArabicGlossary(arDashboard),
        notes: applyArabicGlossary(arNotes), cashSession: applyArabicGlossary(arCashSession),
        statistics: applyArabicGlossary(arStatistics),
      },
    },
    lng: getInitialLanguage(),
    fallbackLng: 'fr',
    supportedLngs: ['fr', 'ar'],
    defaultNS: 'common',
    ns: namespaces,
    interpolation: { escapeValue: false },
  });

i18n.on('languageChanged', applyDocumentLanguage);
applyDocumentLanguage(i18n.resolvedLanguage || i18n.language);

export default i18n;

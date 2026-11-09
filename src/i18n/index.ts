import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { applyDocumentLanguage, getInitialLanguage } from './language';
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

const namespaces = [
  'common', 'nav', 'auth', 'pos', 'products', 'sales', 'invoices', 'clients',
  'repairs', 'expenses', 'reports', 'settings', 'users', 'dashboard',
];

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      fr: {
        common: frCommon, nav: frNav, auth: frAuth, pos: frPos, products: frProducts,
        sales: frSales, invoices: frInvoices, clients: frClients, repairs: frRepairs,
        expenses: frExpenses, reports: frReports, settings: frSettings, users: frUsers,
        dashboard: frDashboard,
      },
      ar: {
        common: arCommon, nav: arNav, auth: arAuth, pos: arPos, products: arProducts,
        sales: arSales, invoices: arInvoices, clients: arClients, repairs: arRepairs,
        expenses: arExpenses, reports: arReports, settings: arSettings, users: arUsers,
        dashboard: arDashboard,
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

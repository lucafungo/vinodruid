import React, { useState, useEffect, useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import ExcelJS from 'exceljs';
import { normalizeBottleSize, normalizeVintage, normalizeCurrency, normalizeDate } from './utils/normalization';
import { WINE_TYPES, WINE_SUBTYPES, TYPE_TO_SUBTYPE, findClosestMatch } from './utils/wineValidation';
import { CheckCircle2, AlertCircle, HelpCircle, ArrowRight, Table, Sparkles, RefreshCcw, RotateCcw, RotateCw, Trash2, Download, Filter, LayoutGrid, Copy, Check, Edit2, X, Calculator, History, Play, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { FileUploader } from './components/FileUploader';
import { SchemaMapper } from './components/SchemaMapper';
import { RulesModal } from './components/RulesModal';
import { RowEditor } from './components/RowEditor';
import { CellarAutocomplete } from './components/CellarAutocomplete';
import { DuplicateComparisonModal } from './components/DuplicateComparisonModal';
import { AddLocationModal } from './components/AddLocationModal';
import { AiFixReviewModal } from './components/AiFixReviewModal';
import { AdminPanel } from './components/AdminPanel';

// --- Types ---

/**
 * Supported data types for import.
 * Currently focused on 'inventory', but extensible to others.
 */
type DataType = 'inventory' | 'client_reserves' | 'contacts' | 'private_clients' | 'trade_clients' | 'suppliers' | 'sales_orders' | 'purchase_orders' | 'cellars';

/**
 * Application workflow steps.
 * - upload: Initial file selection.
 * - map: Mapping CSV headers to schema fields.
 * - review: Validating and editing the data.
 */
type Step = 'upload' | 'map' | 'review';

/**
 * Schema definition for each data type.
 * Defines the expected fields and their default required status.
 * Note: 'inventory' schema is dynamic and adjusted at runtime based on user input.
 */
const SCHEMAS: Record<DataType, { label: string, fields: { key: string, label: string, required: boolean, options?: string[], hint?: string, noAutoCalc?: boolean }[] }> = {
  inventory: {
    label: 'Inventory',
    fields: [
      { key: 'lwin7', label: 'LWIN7', required: true },
      { key: 'listing_wine_name', label: 'Listing Wine Name', required: false },
      { key: 'display_wine_name', label: 'Display Wine Name', required: false },
      { key: 'producer', label: 'Producer', required: false },
      { key: 'vintage', label: 'Vintage', required: true },
      { key: 'country', label: 'Country', required: false },
      { key: 'type', label: 'Type', required: false },
      { key: 'sub_type', label: 'Sub-Type', required: false },
      { key: 'region', label: 'Region', required: false },
      { key: 'sub_region', label: 'Sub-Region', required: false },
      { key: 'abv', label: 'ABV in %', required: true },
      { key: 'case_size', label: 'Case Size', required: true },
      { key: 'size', label: 'Bottle Size (cl)', required: true },
      { key: 'tax_status', label: 'Tax Status', required: true },
      { key: 'case_quantity', label: 'Case Quantity', required: true },
      { key: 'total_quantity', label: 'Total Quantity', required: true },
      { key: 'cellar_name', label: 'Cellar Name', required: true },
      // ... other optional fields
      { key: 'rotation_number', label: 'Rotation Number', required: false },
      { key: 'warehouse_location', label: 'Warehouse Location', required: false },
      { key: 'product_level', label: 'Product-level', required: false },
      { key: 'wine_entry_id', label: 'Wine-entry ID', required: false },
      { key: 'packaging_type', label: 'Packaging Type', required: false },
      { key: 'packaging_code', label: 'Packaging Code', required: false },
      { key: 'exc_vat_case', label: 'EXC. VAT Case', required: false },
      { key: 'exc_vat_ret', label: 'EXC. VAT Retail', required: false },
      { key: 'exc_vat_tra', label: 'EXC. VAT Trade', required: false },
      { key: 'exc_vat_val', label: 'EXC. VAT Value', required: false },
      { key: 'currency', label: 'Currency', required: false },
      { key: 'acquired_on', label: 'Acquired on', required: false },
      { key: 'landed_on', label: 'Landed On', required: false },
      { key: 'product_tags', label: 'Product Tags', required: false },
      { key: 'wine_entry_id_ext', label: 'Wine Entry External ID', required: false },
      { key: 'purchased_from', label: 'Purchased from', required: false },
      { key: 'product_description', label: 'Product Description', required: false },
      { key: 'commodity_code', label: 'Commodity Code', required: false },
      { key: 'grape_variety', label: 'Grape Variety', required: false },
    ]
  },
  client_reserves: {
    label: 'Client Reserves',
    fields: [
      { key: 'account_code', label: 'Account Code', required: true },
      { key: 'lwin7', label: 'LWIN', required: true },
      { key: 'listing_wine_name', label: 'Incoming Wine Name', required: true },
      { key: 'vintage', label: 'Vintage', required: true },
      { key: 'case_size', label: 'Case Size', required: true },
      { key: 'size', label: 'Bottle Size (cl)', required: true },
      { key: 'case_quantity', label: 'Case Qty', required: true },
      { key: 'total_quantity', label: 'Bottles Total Qty', required: true },
      { key: 'tax_status', label: 'Tax Status', required: true },
      { key: 'cellar_name', label: 'Cellar Name', required: true },
      { key: 'rotation_number', label: 'Rotation Number', required: false },
      { key: 'warehouse_location', label: 'Warehouse Location', required: false },
      { key: 'product_level_sku', label: 'Product level SKU', required: false },
      { key: 'packaging_type', label: 'Packaging Type', required: false },
      { key: 'case_cost_price', label: 'Case Cost Price', required: false },
      { key: 'case_selling_price', label: 'Case Selling Price', required: false },
      { key: 'case_resell_cost_price', label: 'Case Resell Cost Price', required: false },
      { key: 'for_sale', label: 'For Sale Y/N', required: false },
      { key: 'currency', label: 'Currency', required: false },
      { key: 'acquired_on', label: 'Acquired On', required: false },
      { key: 'product_tags', label: 'Product Tags', required: false },
      { key: 'condition_notes', label: 'Condition Notes', required: false },
      { key: 'purchased_from', label: 'Purchased from', required: false },
      { key: 'ext_invoice_ref', label: 'EXT Invoice Ref', required: false },
      // Fields for wines without LWINs
      { key: 'producer', label: 'Producer', required: false },
      { key: 'display_wine_name', label: 'Display Wine Name', required: false },
      { key: 'country', label: 'Country', required: false },
      { key: 'region', label: 'Region', required: false },
      { key: 'sub_region', label: 'Sub-Region', required: false },
      { key: 'color', label: 'Color', required: false },
      { key: 'type', label: 'Type', required: false },
      { key: 'sub_type', label: 'Sub-Type', required: false },
      { key: 'abv', label: 'ABV in %', required: true },
    ]
  },
  contacts: {
    label: 'Clients / Contact List',
    fields: [
      { key: 'account_code', label: 'Account Code', required: true },
      { 
        key: 'title', 
        label: 'Client Title', 
        required: false,
        options: [
          'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Brigadier', 'Captain', 'Count', 'H.H.', 'HRH Prince', 
          'Lady', 'PhD', 'Professor', 'Sheikh', 'Sir', 'Master', 'Honourable', 'Major General', 
          'Baron', 'Dato', 'Datuk', 'Datin', 'Tan Sri', 'Ambassador', 'Madam', 'Squire'
        ]
      },
      { key: 'forename', label: 'Client Forename', required: true },
      { key: 'surname', label: 'Client Surname', required: true },
      { key: 'email', label: 'Client Email', required: true },
      { key: 'address_line_1', label: 'Address Line 1', required: true },
      { key: 'address_line_2', label: 'Address Line 2', required: false },
      { key: 'address_line_3', label: 'Address Line 3', required: false },
      { key: 'city', label: 'City', required: true },
      { key: 'county', label: 'County', required: false },
      { key: 'country', label: 'Country', required: true },
      { key: 'post_code', label: 'Post Code', required: false },
      { key: 'mobile', label: 'Mobile', required: false },
      { key: 'phone', label: 'Phone', required: false },
      { key: 'currency', label: 'Currency', required: true },
      { key: 'internal_notes', label: 'Internal Notes', required: false },
      { key: 'tags', label: 'Client Tags', required: false },
      { 
        key: 'payment_terms', 
        label: 'Payment Terms', 
        required: false,
        options: [
          '30 Days', '45 Days', '60 Days', '90 Days', '7 Days', '14 Days', '7 Days - End of Month', 
          '30 Days - End of Month', 'On invoice receipt', 'Prior to collection', 'On release to your agent', 
          'On receipt of wines in your account', 'Not specified', '30 Days - After Collection', 
          'Prior to delivery', '14 Days - End of Month', '45 Days - End of Month', '1 Days - End of Month', 
          '28 Days', 'On Pre-Advice', 'Other', '30 Days prior to release', '60 Days from release', 
          'Broking Terms', 'On Availability', 'Immediate', '10 Days'
        ]
      },
      { key: 'credit_limit', label: 'Credit Limit', required: false },
      { key: 'brokerage', label: 'Brokerage', required: false },
      { key: 'sales_manager', label: 'Sales Manager', required: false },
      { key: 'status', label: 'Client Status', required: false },
      { key: 'bank_name', label: 'Bank Name', required: false },
      { key: 'bank_account_name', label: 'Bank Account Name', required: false },
      { key: 'bank_account_number', label: 'Bank Account Number', required: false },
      { key: 'iban', label: 'IBAN', required: false },
      { key: 'swift', label: 'SWIFT', required: false },
    ]
  },
  private_clients: {
    label: 'Private Clients',
    fields: [
      { key: 'account_code', label: 'Account Code', required: true },
      { 
        key: 'title', 
        label: 'Title', 
        required: false,
        options: [
          'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Brigadier', 'Captain', 'Count', 'H.H.', 'HRH Prince', 
          'Lady', 'PhD', 'Professor', 'Sheikh', 'Sir', 'Master', 'Honourable', 'Major General', 
          'Baron', 'Dato', 'Datuk', 'Datin', 'Tan Sri', 'Ambassador', 'Madam', 'Squire'
        ]
      },
      { key: 'forename', label: 'Forename', required: true },
      { key: 'surname', label: 'Surname', required: true },
      { key: 'email', label: 'Email', required: true },
      { key: 'address_line_1', label: 'Address Line 1', required: true },
      { key: 'address_line_2', label: 'Address Line 2', required: false },
      { key: 'address_line_3', label: 'Address Line 3', required: false },
      { key: 'city', label: 'City', required: true },
      { key: 'county', label: 'County', required: false },
      { key: 'country', label: 'Country', required: true },
      { key: 'post_code', label: 'Post Code', required: false },
      { key: 'mobile', label: 'Mobile', required: false },
      { key: 'phone', label: 'Phone', required: false },
      { key: 'currency', label: 'Currency', required: true },
      { key: 'internal_notes', label: 'Internal Notes', required: false },
      { key: 'tags', label: 'Tags', required: false },
      { 
        key: 'payment_terms', 
        label: 'Payment Terms', 
        required: false,
        options: [
          '30 Days', '45 Days', '60 Days', '90 Days', '7 Days', '14 Days', '7 Days - End of Month', 
          '30 Days - End of Month', 'On invoice receipt', 'Prior to collection', 'On release to your agent', 
          'On receipt of wines in your account', 'Not specified', '30 Days - After Collection', 
          'Prior to delivery', '14 Days - End of Month', '45 Days - End of Month', '1 Days - End of Month', 
          '28 Days', 'On Pre-Advice', 'Other', '30 Days prior to release', '60 Days from release', 
          'Broking Terms', 'On Availability', 'Immediate', '10 Days'
        ]
      },
      { key: 'credit_limit', label: 'Credit Limit', required: false },
      { key: 'brokerage', label: 'Brokerage', required: false },
      { key: 'sales_manager', label: 'Sales Manager', required: false },
      { key: 'status', label: 'Status', required: false },
      { key: 'bank_name', label: 'Bank Name', required: false },
      { key: 'bank_account_name', label: 'Bank Account Name', required: false },
      { key: 'bank_account_number', label: 'Bank Account Number', required: false },
      { key: 'iban', label: 'IBAN', required: false },
      { key: 'swift', label: 'SWIFT', required: false },
    ]
  },
  trade_clients: {
    label: 'Trade Clients',
    fields: [
      { key: 'account_code', label: 'Account Code', required: true },
      { key: 'company_name', label: 'Company Name', required: true },
      {
        key: 'title',
        label: 'Title',
        required: false,
        options: [
          'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Brigadier', 'Captain', 'Count', 'H.H.', 'HRH Prince',
          'Lady', 'PhD', 'Professor', 'Sheikh', 'Sir', 'Master', 'Honourable', 'Major General',
          'Baron', 'Dato', 'Datuk', 'Datin', 'Tan Sri', 'Ambassador', 'Madam', 'Squire'
        ]
      },
      { key: 'forename', label: 'Contact First Name', required: true },
      { key: 'surname', label: 'Contact Surname', required: true },
      { key: 'email', label: 'Email', required: true },
      { key: 'address_line_1', label: 'Address Line 1', required: true },
      { key: 'address_line_2', label: 'Address Line 2', required: false },
      { key: 'address_line_3', label: 'Address Line 3', required: false },
      { key: 'city', label: 'City', required: true },
      { key: 'county', label: 'County', required: false },
      { key: 'country', label: 'Country', required: true },
      { key: 'post_code', label: 'Post Code', required: false },
      { key: 'mobile', label: 'Mobile', required: false },
      { key: 'phone', label: 'Phone', required: false },
      { key: 'currency', label: 'Currency', required: true },
      { key: 'internal_notes', label: 'Internal Notes', required: false },
      { key: 'tags', label: 'Tags', required: false },
      { 
        key: 'payment_terms', 
        label: 'Payment Terms', 
        required: false,
        options: [
          '30 Days', '45 Days', '60 Days', '90 Days', '7 Days', '14 Days', '7 Days - End of Month', 
          '30 Days - End of Month', 'On invoice receipt', 'Prior to collection', 'On release to your agent', 
          'On receipt of wines in your account', 'Not specified', '30 Days - After Collection', 
          'Prior to delivery', '14 Days - End of Month', '45 Days - End of Month', '1 Days - End of Month', 
          '28 Days', 'On Pre-Advice', 'Other', '30 Days prior to release', '60 Days from release', 
          'Broking Terms', 'On Availability', 'Immediate', '10 Days'
        ]
      },
      { key: 'credit_limit', label: 'Credit Limit', required: false },
      { key: 'brokerage', label: 'Brokerage', required: false },
      { key: 'sales_manager', label: 'Sales Manager', required: false },
      { key: 'status', label: 'Status', required: false },
      { key: 'bank_name', label: 'Bank Name', required: false },
      { key: 'bank_account_name', label: 'Bank Account Name', required: false },
      { key: 'bank_account_number', label: 'Bank Account Number', required: false },
      { key: 'iban', label: 'IBAN', required: false },
      { key: 'swift', label: 'SWIFT', required: false },
    ]
  },
  suppliers: {
    label: 'Suppliers',
    fields: [
      { key: 'account_code', label: 'Account Code', required: true },
      { 
        key: 'title', 
        label: 'Title', 
        required: false,
        options: [
          'Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Brigadier', 'Captain', 'Count', 'H.H.', 'HRH Prince', 
          'Lady', 'PhD', 'Professor', 'Sheikh', 'Sir', 'Master', 'Honourable', 'Major General', 
          'Baron', 'Dato', 'Datuk', 'Datin', 'Tan Sri', 'Ambassador', 'Madam', 'Squire'
        ]
      },
      { key: 'company_name', label: 'Company Name', required: true },
      { key: 'forename', label: 'Contact First Name', required: false },
      { key: 'surname', label: 'Contact Surname', required: false },
      { key: 'main_contact_email', label: 'Main Contact Email', required: true },
      { key: 'address_line_1', label: 'Address Line 1', required: true },
      { key: 'address_line_2', label: 'Address Line 2', required: false },
      { key: 'address_line_3', label: 'Address Line 3', required: false },
      { key: 'city', label: 'City', required: true },
      { key: 'county', label: 'County', required: false },
      { key: 'country', label: 'Country', required: true },
      { key: 'post_code', label: 'Post Code', required: false },
      { key: 'mobile', label: 'Mobile', required: false },
      { key: 'phone', label: 'Phone', required: false },
      { key: 'currency', label: 'Currency', required: true },
      { key: 'internal_notes', label: 'Internal Notes', required: false },
      { key: 'tags', label: 'Tags', required: false },
      { 
        key: 'payment_terms', 
        label: 'Payment Terms', 
        required: false,
        options: [
          '30 Days', '45 Days', '60 Days', '90 Days', '7 Days', '14 Days', '7 Days - End of Month', 
          '30 Days - End of Month', 'On invoice receipt', 'Prior to collection', 'On release to your agent', 
          'On receipt of wines in your account', 'Not specified', '30 Days - After Collection', 
          'Prior to delivery', '14 Days - End of Month', '45 Days - End of Month', '1 Days - End of Month', 
          '28 Days', 'On Pre-Advice', 'Other', '30 Days prior to release', '60 Days from release', 
          'Broking Terms', 'On Availability', 'Immediate', '10 Days'
        ]
      },
      { key: 'credit_limit', label: 'Credit Limit', required: false },
      { key: 'brokerage', label: 'Brokerage', required: false },
      { key: 'sales_manager', label: 'Sales Manager', required: false },
      { key: 'status', label: 'Status', required: false },
      { key: 'bank_name', label: 'Bank Name', required: false },
      { key: 'bank_account_name', label: 'Bank Account Name', required: false },
      { key: 'bank_account_number', label: 'Bank Account Number', required: false },
      { key: 'iban', label: 'IBAN', required: false },
      { key: 'swift', label: 'SWIFT', required: false },
    ]
  },
  sales_orders: {
    label: 'Sales Orders',
    fields: [
      // Always required
      { key: 'account_code', label: 'Account Code', required: true },
      { key: 'so_number', label: 'SO Number', required: true },
      { key: 'lwin7', label: 'LWIN', required: true },
      { key: 'tax_status', label: 'Tax Status (IB/DP)', required: true },
      { key: 'case_size', label: 'Case Size', required: true },
      { key: 'case_quantity', label: 'Case Qty', required: true },
      { key: 'total_quantity', label: 'Bottles Total Qty', required: true, noAutoCalc: true },
      { key: 'exc_vat_case', label: 'Case Selling Price', required: true, hint: 'IB = EXC. VAT · DP = INC. VAT (20%)' },
      // Conditionally required when no LWIN (wine name first)
      { key: 'listing_wine_name', label: 'Incoming Wine Name', required: false },
      { key: 'vintage', label: 'Vintage', required: false },
      { key: 'size', label: 'Bottle Size (cl)', required: false },
      { key: 'cellar_name', label: 'Cellar Name', required: false },
      // Optional
      { key: 'po_reference', label: 'PO Reference', required: false },
      { key: 'inv_number', label: 'INV Number', required: false },
      { key: 'so_created_date', label: 'SO Created Date', required: false },
      { key: 'so_invoiced_date', label: 'SO Invoiced Date', required: false },
      { key: 'so_payment_date', label: 'SO Payment Date', required: false },
      { key: 'sales_manager', label: 'Sales Manager', required: false },
      { key: 'case_cost_price', label: 'Case Cost Price', required: false, hint: 'IB = EXC. VAT · DP = INC. VAT (20%)' },
      { key: 'product_level_sku', label: 'Product-level SKU', required: false },
      { key: 'wine_entry_sku', label: 'Wine-Entry Level SKU', required: false },
      { key: 'packaging_type', label: 'Packaging Type', required: false },
      { key: 'so_currency', label: 'SO Currency', required: false },
      { key: 'exchange_rate', label: 'Exchange Rate (Inverse)', required: false },
      { key: 'acquired_on', label: 'Date Originally Acquired', required: false },
      { key: 'purchased_from', label: 'Originally Purchased From', required: false },
      { key: 'line_po_reference', label: 'SO-Line PO Reference', required: false },
      { key: 'order_tags', label: 'Order Tags', required: false },
      { key: 'product_tags', label: 'Product Tags', required: false },
      { key: 'delivery_date', label: 'Delivery Date', required: false },
      { key: 'unique_identifier', label: 'Unique Identifier Ref', required: false },
      { key: 'original_supplier', label: 'Original Supplier', required: false },
      { key: 'rotation_number', label: 'Rotation Number', required: false },
      { key: 'so_notes', label: 'SO Internal Notes', required: false },
    ]
  },
  purchase_orders: {
    label: 'Purchase Orders',
    fields: [
      // Always required
      { key: 'account_code', label: 'Account Code', required: true },
      { key: 'po_number', label: 'PO Number', required: true },
      { key: 'tax_status', label: 'PO Tax Status (IB/DP)', required: true },
      { key: 'case_size', label: 'Case Size', required: true },
      { key: 'case_quantity', label: 'Case Qty', required: true },
      { key: 'total_quantity', label: 'Bottles Total Qty', required: true, noAutoCalc: true },
      { key: 'case_cost_price', label: 'Case Cost Price EXC. VAT', required: true, hint: 'IB = EXC. VAT · DP = INC. VAT (20%)' },
      { key: 'lwin7', label: 'LWIN', required: true },
      // Conditionally required when no LWIN
      { key: 'listing_wine_name', label: 'Incoming Wine Name', required: false },
      { key: 'vintage', label: 'Vintage', required: false },
      { key: 'size', label: 'Bottle Size (cl)', required: false },
      { key: 'cellar_name', label: 'Cellar/Location Name', required: false },
      // Optional
      { key: 'po_created_date', label: 'PO Created Date', required: false },
      { key: 'po_invoiced_date', label: 'PO Invoicing Date', required: false },
      { key: 'po_payment_status', label: 'PO Payment Status', required: false },
      { key: 'po_status_invoiced', label: 'PO Status Invoiced', required: false },
      { key: 'po_line_status_delivered', label: 'PO-Line Status Delivered', required: false },
      { key: 'delivery_date', label: 'Wine Entry Delivery Date', required: false },
      { key: 'rotation_number', label: 'Rotation Number', required: false },
      { key: 'warehouse_location', label: 'Warehouse Location', required: false },
      { key: 'product_level_sku', label: 'Product-level SKU', required: false },
      { key: 'wine_entry_sku', label: 'Wine-Entry Level SKU', required: false },
      { key: 'packaging_type', label: 'Packaging Type', required: false },
      { key: 'packaging_condition', label: 'Packaging Condition', required: false },
      { key: 'case_selling_price', label: 'Case Selling Price EXC. VAT', required: false },
      { key: 'po_currency', label: 'Currency', required: false },
      { key: 'acquired_on', label: 'Acquired On', required: false },
      { key: 'product_tags', label: 'Product Tags', required: false },
      { key: 'purchase_manager', label: 'Purchase Manager', required: false },
      { key: 'unique_identifier', label: 'Unique Identifier Ref', required: false },
      { key: 'supplier_invoice_ref', label: 'Supplier Invoice Reference', required: false },
      { key: 'pre_advice_ref', label: 'Pre-Advice Reference', required: false },
      { key: 'po_notes', label: 'PO Internal Notes', required: false },
    ]
  },
  cellars: {
    label: 'Locations / Cellars',
    fields: [
      { key: 'cellar_name', label: 'Cellar Name', required: true },
      { key: 'location_type', label: 'Location Type', required: true },
      { key: 'cellar_code', label: 'Cellar Code', required: true },
      { key: 'address_line_1', label: 'Address Line 1', required: true },
      { key: 'address_line_2', label: 'Address Line 2', required: false },
      { key: 'address_line_3', label: 'Address Line 3', required: false },
      { key: 'city', label: 'City', required: true },
      { key: 'county', label: 'County', required: false },
      { key: 'country', label: 'Country', required: true },
      { key: 'post_code', label: 'Post Code', required: false },
      { key: 'forename', label: 'Main Contact Forename', required: true },
      { key: 'surname', label: 'Main Contact Surname', required: true },
      { key: 'email', label: 'Main Contact Email', required: true },
      { key: 'contact_type', label: 'Main Contact Type', required: true },
      { key: 'mobile', label: 'Main Contact Mobile', required: false },
      { key: 'phone', label: 'Phone', required: false },
      { key: 'currency', label: 'Currency', required: true },
      { key: 'internal_notes', label: 'Internal Notes', required: false },
      { key: 'create_as_customer_cellar', label: 'Create as customer cellar', required: true },
      { key: 'tax_status', label: 'Tax Status', required: true },
    ]
  }
};

/**
 * Represents a single row of data after processing.
 */
interface ProcessedRow {
  id: number; // Unique index from original file
  raw: any; // The original raw data from the CSV/Excel
  status: 'green' | 'yellow' | 'red'; // Validation status
  errors: string[]; // List of validation error messages
  isDuplicate?: boolean; // Flag for duplicate rows
  duplicateOf?: number; // ID of the row this is a duplicate of
  autoFixedFields?: string[]; // List of fields modified by AI
  calculationLogs?: Record<string, string>; // Explanations for AI calculations
  isPriceOutlier?: boolean; // Flag for price outliers
  priceOutlierType?: 'high' | 'low' | 'global'; // Type of outlier
  priceOutlierRef?: number; // Reference price (median or average)
  priceOutlierRefRowId?: number; // ID of a reference row for comparison
  fieldErrors: string[]; // Track which fields have errors for UI highlighting
  [key: string]: any; // Normalized field values
}

export default function App() {
  const { getAccessTokenSilently, isAuthenticated, loginWithRedirect, logout, isLoading: authLoading } = useAuth0();

  const authFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = await getAccessTokenSilently();
    return fetch(input, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}` },
    });
  }, [getAccessTokenSilently]);

  // --- State Management ---

  // Workflow control
  const [step, setStep] = useState<Step>('upload');
  const [dataType, setDataType] = useState<DataType>('inventory');
  
  // Data storage
  const [rawData, setRawData] = useState<any[]>([]); // Current working copy of raw data
  const [history, setHistory] = useState<any[][]>([]); // Undo history stack
  const [originalRawData, setOriginalRawData] = useState<any[]>([]); // Immutable copy of original upload
  const [headers, setHeaders] = useState<string[]>([]); // CSV/Excel headers
  const [fileName, setFileName] = useState<string>('');
  
  // Processing state
  const [mapping, setMapping] = useState<Record<string, string>>({}); // Map: Schema Field -> CSV Header
  const [processedData, setProcessedData] = useState<ProcessedRow[]>([]); // Validated and normalized data
  
  // UI state
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: number, fieldKey: string } | null>(null);
  const [editStartingValue, setEditStartingValue] = useState<string | null>(null);

  const startEditingCell = (rowId: number, fieldKey: string) => {
    const row = processedData.find(r => r.id === rowId);
    const value = row ? row[fieldKey] : null;
    setEditStartingValue(value === null || value === undefined ? '' : String(value));
    setEditingCell({ rowId, fieldKey });
  };
  const [comparingDuplicate, setComparingDuplicate] = useState<{ row1: number, row2: number } | null>(null);
  const [reviewQueueType, setReviewQueueType] = useState<'duplicate' | 'price' | null>(null);
  const [pendingQueueAdvance, setPendingQueueAdvance] = useState(false);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isAiReviewModalOpen, setIsAiReviewModalOpen] = useState(false);
  const [pendingAiChanges, setPendingAiChanges] = useState<any[]>([]);
  const [aiChangesSummary, setAiChangesSummary] = useState<any[]>([]);
  
  // Session persistence
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  
  // Edit tracking
  const [autoFixedMap, setAutoFixedMap] = useState<Record<number, string[]>>({}); // Track AI fixes
  const [calculationLogsMap, setCalculationLogsMap] = useState<Record<number, Record<string, string>>>({}); // Track AI calculation explanations
  const [manualEditsMap, setManualEditsMap] = useState<Record<number, string[]>>({}); // Track user edits
  const [ignoredDuplicates, setIgnoredDuplicates] = useState<Set<number>>(new Set()); // Track dismissed duplicates
  const [ignoredPriceWarnings, setIgnoredPriceWarnings] = useState<Set<number>>(new Set()); // Track dismissed price warnings

  // Master Data
  const [masterCellars, setMasterCellars] = useState<string[]>([]);
  const [masterClients, setMasterClients] = useState<string[]>([]);
  const [showAddLocationModal, setShowAddLocationModal] = useState(false);

  useEffect(() => {
    authFetch('/api/master/cellars')
      .then(r => r.json())
      .then(data => setMasterCellars(data))
      .catch(e => console.error("Failed to load master cellars", e));
    authFetch('/api/master/clients')
      .then(r => r.json())
      .then(data => setMasterClients(data))
      .catch(e => console.error("Failed to load master clients", e));
    authFetch('/api/master/regions')
      .then(r => r.json())
      .then(data => setRegionRefData(data))
      .catch(e => console.error("Failed to load regions", e));
    loadSessions();
  }, [authFetch]);

  useEffect(() => {
    if (step === 'upload') {
      loadSessions();
      // If we are back at home, we keep currentSessionId so the user can easily jump back
      // but we don't clear it unless it's a "Start New" action.
    }
  }, [step]);

  // Auto-sync session state
  useEffect(() => {
    if (currentSessionId && step !== 'upload') {
      const updateSession = async () => {
        try {
          await authFetch(`/api/sessions/${currentSessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                fileName,
                dataType,
                mapping,
                currentStep: step,
                autoFixedMap,
                manualEditsMap,
                calculationLogsMap,
                ignoredDuplicates: Array.from(ignoredDuplicates),
                ignoredPriceWarnings: Array.from(ignoredPriceWarnings)
              }
            })
          });
        } catch (err) {
          console.error('Failed to sync session state', err);
        }
      };
      
      const timer = setTimeout(updateSession, 2000); // Debounce
      return () => clearTimeout(timer);
    }
  }, [currentSessionId, step, mapping, fileName, dataType, autoFixedMap, manualEditsMap, calculationLogsMap, ignoredDuplicates, ignoredPriceWarnings]);

  const loadSessions = async () => {
    setIsLoadingSessions(true);
    try {
      const response = await authFetch('/api/sessions');
      if (response.ok) {
        const data = await response.json();
        setSessions(data);
      }
    } catch (error) {
      console.error("Failed to load sessions", error);
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const handleLoadSession = async (sessionId: number) => {
    setIsAiProcessing(true); // Re-use for loading state
    console.log('[Resume] Loading session:', sessionId);
    try {
      const response = await authFetch(`/api/sessions/${sessionId}`);
      if (response.ok) {
        const data = await response.json();
        
        // Handle database column naming (fields_json vs fields)
        const rawFields = data.fields_json || data.fields || {};
        const fields = typeof rawFields === 'string' ? JSON.parse(rawFields) : rawFields;
        
        const rawMapping = data.mapping_json || data.mapping || {};
        const map = typeof rawMapping === 'string' ? JSON.parse(rawMapping) : rawMapping;

        const rows = data.rows || [];
        const dt = (fields.dataType as DataType) || 'inventory';
        // 'lwin-check' step no longer exists — redirect old sessions to mapping
        const rawStep = fields.currentStep === 'lwin-check' ? 'map' : fields.currentStep;
        const st = (rawStep as Step) || 'review';

        console.log('[Resume] Session data loaded:', { sessionId: data.id, step: st, dataType: dt, rowCount: rows.length });

        // Restore all maps
        setAutoFixedMap(fields.autoFixedMap || {});
        setManualEditsMap(fields.manualEditsMap || {});
        setCalculationLogsMap(fields.calculationLogsMap || {});
        setIgnoredDuplicates(new Set(fields.ignoredDuplicates || []));
        setIgnoredPriceWarnings(new Set(fields.ignoredPriceWarnings || []));

        // Set ID first to silence auto-sync loop if needed (though it debounces)
        setCurrentSessionId(data.id);
        
        setFileName(fields.fileName || 'Loaded Session');
        setDataType(dt);
        
        // Correctly reconstruct rawData from rows to ensure no original headers are lost.
        const reconstructedRaw = rows.map((r: any, idx: number) => {
          const { id, db_id, updated_at, status, errors, fieldErrors, raw, manualEdits, isDuplicate, isPriceOutlier, calculation_logs, ...rest } = r;
          
          // Merge schema fields (rest) back into the original raw object if it exists.
          // This ensures that even if some fields were updated but not the original headers, we have a complete view.
          const merged = { ...(raw || {}), ...rest, id: idx };
          return merged;
        });
        
        setRawData(reconstructedRaw);
        setOriginalRawData(JSON.parse(JSON.stringify(reconstructedRaw)));

        // Reconstruct headers
        if (reconstructedRaw.length > 0) {
          const firstRow = reconstructedRaw[0];
          const systemKeys = ['id', 'db_id', 'updated_at', 'status', 'errors', 'fieldErrors', 'raw', 'manualEdits', 'isDuplicate', 'isPriceOutlier', 'calculation_logs'];
          const filteredKeys = Object.keys(firstRow).filter(k => !systemKeys.includes(k));
          setHeaders(filteredKeys);
        }

        setMapping(map);
        
        // If we were already in review, trust the DB rows directly as processedData
        // This ensures modifications (like calculated values) are preserved exactly
        if (st === 'review' && rows.length > 0) {
          // Normalize rows to ensure they have expected arrays
          const normalizedRows = rows.map((r: any) => ({
            ...r,
            errors: r.errors || [],
            fieldErrors: r.fieldErrors || [],
            status: r.status || 'green'
          }));
          setProcessedData(normalizedRows);
        } else if (Object.keys(map).length > 0) {
          const processed = processData(
            reconstructedRaw, 
            map, 
            regionRefData,
            new Set(fields.ignoredDuplicates || []),
            fields.autoFixedMap || {},
            fields.manualEditsMap || {},
            new Set(fields.ignoredPriceWarnings || []),
            fields.calculationLogsMap || {}
          );
          setProcessedData(processed);
        } else {
          setProcessedData(rows);
        }
        
        // Finalize step
        setStep(st);
        
        // Reload list to reflect active state
        loadSessions();
      } else {
        throw new Error('Failed to fetch session details');
      }
    } catch (error) {
      console.error("[Resume] Failed to load session details", error);
      setValidationError("Failed to load session. It might have been deleted.");
    } finally {
      setIsAiProcessing(false);
    }
  };

  const handleDeleteSession = async (sessionId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    const confirmed = window.confirm("Are you sure you want to PERMANENTLY delete this session and all its data? This cannot be undone.");
    if (!confirmed) return;
    
    try {
      const response = await authFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      if (response.ok) {
        loadSessions();
        if (currentSessionId === sessionId) {
          goHome();
        }
      } else {
        const err = await response.json();
        alert(`Failed to delete: ${err.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error("Failed to delete session", error);
    }
  };

  const handleSaveMasterData = () => {
    if (dataType === 'cellars') {
      const validCellarNames = processedData
        .filter(r => r.status !== 'red')
        .map(r => String(r.cellar_name || '').trim())
        .filter(name => name !== '');
      const newMasterList = Array.from(new Set([...masterCellars, ...validCellarNames]));
      setMasterCellars(newMasterList);
      authFetch('/api/master/cellars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: newMasterList }),
      }).catch(e => console.error("Failed to save master cellars", e));
    } else if (dataType === 'contacts' || dataType === 'private_clients' || dataType === 'trade_clients' || dataType === 'suppliers') {
      const validAccountCodes = processedData
        .filter(r => r.status !== 'red')
        .map(r => String(r.account_code || '').trim())
        .filter(code => code !== '');
      const newMasterList = Array.from(new Set([...masterClients, ...validAccountCodes]));
      setMasterClients(newMasterList);
      authFetch('/api/master/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: newMasterList }),
      }).catch(e => console.error("Failed to save master clients", e));
    }
  };

  const handleClearMasterData = (type: string) => {
    if (type === 'cellars') {
      setMasterCellars([]);
      authFetch('/api/master/cellars', { method: 'DELETE' })
        .catch(e => console.error("Failed to clear master cellars", e));
    } else if (type === 'contacts' || type === 'private_clients' || type === 'trade_clients' || type === 'suppliers') {
      setMasterClients([]);
      authFetch('/api/master/clients', { method: 'DELETE' })
        .catch(e => console.error("Failed to clear master clients", e));
    }
  };
  
  const handleAddLocation = (data: Record<string, string>) => {
    const cellarName = data.cellar_name?.trim();
    if (!cellarName) return;
    const newList = Array.from(new Set([...masterCellars, cellarName]));
    setMasterCellars(newList);
    fetch('/api/master/cellars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: newList }),
    }).catch(e => console.error('Failed to save master cellars', e));
    setShowAddLocationModal(false);
  };

  // Inventory specific state
  const [regionRefData, setRegionRefData] = useState<any[]>([]);

  const [hasAutoFixed, setHasAutoFixed] = useState(false);
  const [showOnlyEdited, setShowOnlyEdited] = useState(false);
  const [pendingBulkAction, setPendingBulkAction] = useState<{
    field: string;
    oldValue: string;
    newValue: string;
    rowIds: number[];
  } | null>(null);

  /**
   * Applies the proposed bulk fix to all matching rows.
   */
  const applyBulkFix = () => {
    if (!pendingBulkAction) return;

    // Save current state to history
    setHistory(prev => [...prev, JSON.parse(JSON.stringify(rawData))].slice(-20));

    const newData = [...rawData];
    const { field, newValue, rowIds } = pendingBulkAction;
    const targetKey = mapping[field] || field;

    rowIds.forEach(id => {
      const rawRow = { ...newData[id] };
      rawRow[targetKey] = newValue;
      newData[id] = rawRow;
    });

    // Update manual edits map
    const newManualEditsMap = { ...manualEditsMap };
    rowIds.forEach(id => {
      newManualEditsMap[id] = Array.from(new Set([...(newManualEditsMap[id] || []), field]));
    });
    setManualEditsMap(newManualEditsMap);

    setRawData(newData);
    setPendingBulkAction(null);
    
    // Re-validate
    const processed = processData(newData, mapping, regionRefData, ignoredDuplicates, autoFixedMap, newManualEditsMap, ignoredPriceWarnings, calculationLogsMap);
    setProcessedData(processed);

    if (currentSessionId) {
      handleBulkUpdateRows(processed.filter(r => rowIds.includes(r.id)));
    }
  };

  // Completed Tasks state — org-scoped, loaded synchronously from localStorage cache
  const [orgId, setOrgId] = useState<number>(() =>
    parseInt(localStorage.getItem('_vd_org_id') ?? '1', 10)
  );
  const completedStorageKey = `completed_tasks_org_${orgId}`;
  const [completedTasks, setCompletedTasks] = useState<Record<string, { data: any[], fileName: string, completedAt: string }>>(() => {
    const key = `completed_tasks_org_${parseInt(localStorage.getItem('_vd_org_id') ?? '1', 10)}`;
    let raw = localStorage.getItem(key);
    if (!raw) {
      // One-time migration from old unscoped key
      const legacy = localStorage.getItem('completed_tasks');
      if (legacy) {
        localStorage.setItem(key, legacy);
        localStorage.removeItem('completed_tasks');
        raw = legacy;
      }
    }
    try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });
  const [openCompletedDropdown, setOpenCompletedDropdown] = useState<DataType | null>(null);

  const [showAdmin, setShowAdmin] = useState(false);

  const [currentUser, setCurrentUser] = useState<{
    user_id: number;
    display_name: string;
    forename: string;
    organisation_id: number;
    organisation_name: string;
    user_access: string;
  } | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Fetch identity from backend — validates org + user and updates org-scoped storage key
  useEffect(() => {
    authFetch('/api/me')
      .then(r => r.json().then(d => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (!ok) {
          setAuthError(data.detail ?? 'Unknown authentication error.');
          return;
        }
        const id = data.organisation_id as number;
        localStorage.setItem('_vd_org_id', String(id));
        setCurrentUser(data);
        if (id !== orgId) {
          setOrgId(id);
          const key = `completed_tasks_org_${id}`;
          const raw = localStorage.getItem(key);
          try { setCompletedTasks(raw ? JSON.parse(raw) : {}); } catch { setCompletedTasks({}); }
        }
      })
      .catch(err => console.error('[/api/me]', err));
  }, [authFetch]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openCompletedDropdown) {
        const target = event.target as HTMLElement;
        if (!target.closest('.group\\/btn')) {
          setOpenCompletedDropdown(null);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openCompletedDropdown]);

  const handleMarkAsComplete = async () => {
    // Only allow if all rows are green
    const allReady = processedData.every(r => r.status === 'green');
    if (!allReady) return;

    // Add to master list first
    handleSaveMasterData();

    const newCompleted = {
      ...completedTasks,
      [dataType]: {
        data: processedData,
        fileName: fileName,
        completedAt: new Date().toISOString()
      }
    };

    setCompletedTasks(newCompleted);
    localStorage.setItem(completedStorageKey, JSON.stringify(newCompleted));
    
    // Update session status in DB
    if (currentSessionId) {
      try {
        await authFetch(`/api/sessions/${currentSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' })
        });
        loadSessions(); // Refresh sessions list
      } catch (error) {
        console.error("Failed to mark session as completed in DB", error);
      }
    }

    // Reset dropdown state
    setOpenCompletedDropdown(null);
    
    // Optionally redirect to home
    setStep('upload');
    setCurrentSessionId(null);
  };

  const handleClearCompletedTask = (type: string) => {
    const newCompleted = { ...completedTasks };
    delete newCompleted[type];
    setCompletedTasks(newCompleted);
    localStorage.setItem(completedStorageKey, JSON.stringify(newCompleted));
    setOpenCompletedDropdown(null);
  };

  const handleReopenSession = async (sessionId: number, type: DataType) => {
    try {
      await authFetch(`/api/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' })
      });
    } catch (e) {
      console.error('[Reopen] Failed to update session status', e);
    }
    const newCompleted = { ...completedTasks };
    delete newCompleted[type];
    setCompletedTasks(newCompleted);
    localStorage.setItem(completedStorageKey, JSON.stringify(newCompleted));
    setOpenCompletedDropdown(null);
    await handleLoadSession(sessionId);
  };

  const handleDownloadAllCompleted = async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    Object.keys(completedTasks).forEach((type) => {
      const task = completedTasks[type];
      const schema = SCHEMAS[type as DataType];
      const headers = schema.fields.map(f => f.label).join(',');
      const rows = task.data.map(row =>
        schema.fields.map(field => {
          let val = row[field.key];
          if (typeof val === 'object' && val?.value !== undefined) val = `${val.currency} ${val.value}`;
          const s = String(val || '');
          return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(',')
      );
      const csv = [headers, ...rows].join('\n');
      const safeName = `${type}_${(task.fileName.split('.')[0] || type)}.csv`;
      zip.file(safeName, csv);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vinoclean_completed_exports.zip';
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportCompleted = (type: string) => {
    const task = completedTasks[type];
    if (!task) return;

    const currentSchema = SCHEMAS[type as DataType];
    const csvHeaders = currentSchema.fields.map(f => f.label).join(',');
    
    const rows = task.data.map(row => {
      return currentSchema.fields.map(field => {
        let val = row[field.key];
        if (typeof val === 'object' && val?.value !== undefined) {
          val = `${val.currency} ${val.value}`;
        }
        const stringVal = String(val || '');
        if (stringVal.includes(',') || stringVal.includes('"') || stringVal.includes('\n')) {
          return `"${stringVal.replace(/"/g, '""')}"`;
        }
        return stringVal;
      }).join(',');
    });
    
    const csvContent = [csvHeaders, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `completed_${task.fileName.split('.')[0] || 'data'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setOpenCompletedDropdown(null);
  };

  // --- Handlers ---

  useEffect(() => {
    // Auto-fix disabled as per user feedback "ai is messing up the file"
    // We now provide a manual button instead
  }, []);

  /**
   * Dynamically determines the active schema based on user input.
   * For 'inventory', it adjusts required fields based on whether the user has LWINs.
   */
  const getCurrentSchema = () => {
    const base = SCHEMAS[dataType];
    if (dataType !== 'inventory' && dataType !== 'client_reserves' && dataType !== 'sales_orders' && dataType !== 'purchase_orders') return base;
    // LWIN and descriptive fields are validated per-row in processData.
    // The mapper only needs to know which columns exist — lwin7 is optional here.
    return {
      ...base,
      fields: base.fields.map(f => f.key === 'lwin7' ? { ...f, required: false } : f)
    };
  };

  /**
   * Exports the cleaned data to a CSV file.
   * Only exports rows that are NOT red (invalid).
   */
  const handleExport = () => {
    if (processedData.length === 0) return;
    
    const currentSchema = getCurrentSchema();
    const csvHeaders = currentSchema.fields.map(f => f.label).join(',');
    
    const rows = processedData
      .filter(r => r.status !== 'red') // Only export valid or reviewable rows
      .map(row => {
        return currentSchema.fields.map(field => {
          let val = row[field.key];
          // Handle currency objects
          if (typeof val === 'object' && val?.value !== undefined) {
            val = `${val.currency} ${val.value}`;
          }
          // Escape quotes and wrap in quotes if contains comma
          const stringVal = String(val || '');
          if (stringVal.includes(',') || stringVal.includes('"') || stringVal.includes('\n')) {
            return `"${stringVal.replace(/"/g, '""')}"`;
          }
          return stringVal;
        }).join(',');
      });
    
    const csvContent = [csvHeaders, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `clean_${fileName.split('.')[0] || 'data'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Mark session as completed
    if (currentSessionId) {
      authFetch(`/api/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      }).then(() => loadSessions()).catch(err => console.error("Failed to mark session as completed", err));
    }
  };

  const handleExportErrors = () => {
    const errorRows = processedData.filter(r => r.status === 'red');
    if (errorRows.length === 0) return;

    const currentSchema = getCurrentSchema();
    const csvHeaders = [...currentSchema.fields.map(f => f.label), 'Errors to Fix'].join(',');

    const rows = errorRows.map(row => {
      const fields = currentSchema.fields.map(field => {
        let val = row[field.key];
        if (typeof val === 'object' && val?.value !== undefined) {
          val = `${val.currency} ${val.value}`;
        }
        const stringVal = String(val || '');
        if (stringVal.includes(',') || stringVal.includes('"') || stringVal.includes('\n')) {
          return `"${stringVal.replace(/"/g, '""')}"`;
        }
        return stringVal;
      });
      const errorsVal = row.errors?.join('; ') || '';
      fields.push(`"${errorsVal.replace(/"/g, '""')}"`);
      return fields.join(',');
    });

    const csvContent = [csvHeaders, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `errors_${fileName.split('.')[0] || 'data'}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /**
   * Handles the initial file upload.
   * Parses the file, sets raw data, and determines the next step.
   * - If Inventory: Go to LWIN check.
   * - Others: Go directly to Mapping.
   */
  const handleUpload = (data: any[], fields: string[], name: string) => {
    setValidationError(null);
    setCurrentSessionId(null);

    if ((dataType === 'inventory' || dataType === 'client_reserves' || dataType === 'sales_orders' || dataType === 'purchase_orders') && masterCellars.length === 0) {
      setValidationError("Please load your Cellars first. This import type requires a Master Cellar List for validation.");
      return;
    }

    if ((dataType === 'client_reserves' || dataType === 'sales_orders') && masterClients.length === 0) {
      setValidationError("Please load Private Clients, Trade Clients, or Suppliers first. This import type requires existing Account Codes for validation.");
      return;
    }

    const dataWithIds = data.map((r, i) => ({ ...r, id: i }));
    setRawData(dataWithIds);
    setOriginalRawData(JSON.parse(JSON.stringify(dataWithIds))); // Deep copy for reset functionality
    setHeaders(fields);
    setFileName(name);
    setManualEditsMap({});
    setIgnoredDuplicates(new Set());
    
    // Always go to mapping first — LWIN presence is detected per-row during processing
    const initialStep: Step = 'map';

    const initialProcessed = processData(dataWithIds, {});
    setProcessedData(initialProcessed);
    
    // Create initial session in DB
    try {
      authFetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionType: `${dataType}: ${name}`,
          rows: dataWithIds,
          fields: { mapping: {}, fileName: name, dataType: dataType, currentStep: initialStep }
        })
      }).then(res => res.json()).then(result => {
        if (result.id) {
          setCurrentSessionId(result.id);
          loadSessions();
        }
      });
    } catch (error) {
      console.error("Failed to create initial session", error);
    }
    
    setStep(initialStep);
  };

  /**
   * Triggered when the user finishes mapping columns.
   * Applies the mapping and runs the initial data processing.
   */
  const handleSaveSession = async (processed: ProcessedRow[], currentMapping: Record<string, string>) => {
    try {
      // Prepare the payload to match server.ts expectations
      const fields = {
        fileName,
        dataType,
        mapping: currentMapping,
        currentStep: 'review',
        autoFixedMap,
        manualEditsMap,
        calculationLogsMap,
        ignoredDuplicates: Array.from(ignoredDuplicates),
        ignoredPriceWarnings: Array.from(ignoredPriceWarnings)
      };

      const response = await authFetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionType: dataType,
          status: 'review',
          fields: fields,
          // We store the full processed object which includes the raw reference
          rows: processed
        }),
      });
      if (response.ok) {
        const result = await response.json();
        setCurrentSessionId(result.id);
        loadSessions();
      }
    } catch (error) {
      console.error('Failed to save session', error);
    }
  };

  const handleMappingComplete = async (newMapping: Record<string, string>) => {
    setMapping(newMapping);
    setHasAutoFixed(false);
    
    // Check if we should auto-calculate anything
    const hasInventoryMappings = dataType === 'inventory' || dataType === 'client_reserves' || dataType === 'sales_orders' || dataType === 'purchase_orders';
    const canCalc = hasInventoryMappings && (
      (newMapping['case_size'] && newMapping['case_quantity']) || 
      (newMapping['total_quantity'] && newMapping['case_size']) ||
      ((newMapping['price'] || newMapping['exc_vat_case'] || newMapping['case_cost_price']) && (newMapping['total_quantity'] || (newMapping['case_size'] && newMapping['case_quantity'])))
    );
    
    let processed: ProcessedRow[] = [];
    if (canCalc) {
      processed = handleCalculationSmartFix(rawData, newMapping, true);
    } else {
      processed = processData(
        rawData, 
        newMapping, 
        regionRefData, 
        ignoredDuplicates, 
        autoFixedMap, 
        manualEditsMap, 
        ignoredPriceWarnings, 
        calculationLogsMap
      );
    }
    setProcessedData(processed);

    if (!currentSessionId) {
      handleSaveSession(processed, newMapping);
    } else {
      // Sync to existing session
      try {
        await authFetch(`/api/sessions/${currentSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              fileName,
              dataType,
              mapping: newMapping,
              currentStep: 'review',
              autoFixedMap,
              manualEditsMap,
              calculationLogsMap,
              ignoredDuplicates: Array.from(ignoredDuplicates),
              ignoredPriceWarnings: Array.from(ignoredPriceWarnings)
            }
          })
        });
        handleBulkUpdateRows(processed, true);
      } catch (err) {
        console.error('Failed to sync mapping completion', err);
      }
    }
    
    setStep('review');
  };

  /**
   * Updates a single row or cell with manual edits.
   * - Saves state to history for Undo.
   * - Updates raw data.
   * - Tracks manual edits for highlighting.
   * - Re-runs validation.
   */
  const handleRowUpdate = (updatedRow: any, editedFieldKey?: string) => {
    if (!updatedRow) return;

    // Save current state to history before changing
    setHistory(prev => [...prev, JSON.parse(JSON.stringify(rawData))].slice(-20));

    // Create a NEW array and CLONE the row we are about to modify to avoid reference issues
    const newData = [...rawData];
    
    if (updatedRow.id === undefined) {
      console.error('[UpdateRow] Row has no ID:', updatedRow);
      return;
    }

    // Find the row by ID. We must be robust here.
    let rowIndex = newData.findIndex(r => r.id === updatedRow.id);
    
    // Fallback: if we can't find by ID property, but the ID is within array bounds,
    // we assume the ID is the index (which is consistent with processData's behavior).
    if (rowIndex === -1 && typeof updatedRow.id === 'number' && updatedRow.id >= 0 && updatedRow.id < newData.length) {
      rowIndex = updatedRow.id;
    }

    if (rowIndex === -1) {
      console.error('[UpdateRow] Could not find row in rawData with id:', updatedRow.id);
      return;
    }
    
    const currentRow = newData[rowIndex];
    
    // We MUST preserve all fields in the original raw object. 
    // processData depends on these original headers.
    const rawRow = currentRow ? { ...currentRow } : { id: updatedRow.id };
    
    // Track manual edits (use new object for immediate re-validation)
    let nextManualEditsMap = { ...manualEditsMap };
    if (editedFieldKey) {
      // Single field update
      const targetKey = mapping[editedFieldKey] || editedFieldKey;
      rawRow[targetKey] = updatedRow[editedFieldKey];
      
      // Also update the key itself in rawRow to ensure immediate visibility if mapping fails
      if (targetKey !== editedFieldKey) {
        rawRow[editedFieldKey] = updatedRow[editedFieldKey];
      }
      
      nextManualEditsMap[updatedRow.id] = Array.from(new Set([...(nextManualEditsMap[updatedRow.id] || []), editedFieldKey]));
      setManualEditsMap(nextManualEditsMap);
    } else {
      // Full row update (from RowEditor)
      let rowEdits = nextManualEditsMap[updatedRow.id] || [];
      getCurrentSchema().fields.forEach(field => {
        const key = field.key;
        if (updatedRow[key] !== undefined && updatedRow[key] !== null) {
          const targetKey = mapping[key] || key;
          rawRow[targetKey] = updatedRow[key];
          // Always update local key too for safety
          if (targetKey !== key) {
            rawRow[key] = updatedRow[key];
          }
          rowEdits = Array.from(new Set([...rowEdits, key]));
        }
      });
      nextManualEditsMap[updatedRow.id] = rowEdits;
      setManualEditsMap(nextManualEditsMap);
    }
    
    newData[rowIndex] = rawRow;
    
    // If we're updating a row, we should probably re-evaluate its duplicate/price status
    const newIgnoredDups = new Set<number>(ignoredDuplicates);
    newIgnoredDups.delete(updatedRow.id);
    setIgnoredDuplicates(newIgnoredDups);

    const newIgnoredPrice = new Set<number>(ignoredPriceWarnings);
    newIgnoredPrice.delete(updatedRow.id);
    setIgnoredPriceWarnings(newIgnoredPrice);
    
    setRawData(newData);
    
    // --- Bulk Fix Detection ---
    if (editedFieldKey && editStartingValue !== null) {
      const oldVal = editStartingValue;
      const newVal = updatedRow[editedFieldKey];
      
      // We only suggest bulk fixes for specific fields
      const bulkFixableFields = ['cellar_name', 'account_code', 'producer', 'country', 'region', 'lwin7', 'sub_region', 'vintage'];
      
      if (oldVal && newVal && String(oldVal).trim() !== String(newVal).trim() && bulkFixableFields.includes(editedFieldKey)) {
        const otherRowsWithSameVal = processedData.filter(r => 
          r.id !== updatedRow.id && 
          String(r[editedFieldKey] || '').trim() === String(oldVal).trim() &&
          r.status === 'red'
        );

        if (otherRowsWithSameVal.length >= 1) {
          setPendingBulkAction({
            field: editedFieldKey,
            oldValue: String(oldVal),
            newValue: String(newVal),
            rowIds: otherRowsWithSameVal.map(r => r.id)
          });
        }
      }
      setEditStartingValue(null);
    }
    
    // Check if the edited field should trigger a re-calculation
    const calcFields = ['case_size', 'case_quantity', 'total_quantity', 'case_cost_price', 'exc_vat_case', 'total'];
    let processed: ProcessedRow[] = [];
    
    // If we are editing a mapped field, we must re-process to catch side effects
    if (editedFieldKey && calcFields.includes(editedFieldKey)) {
      processed = handleCalculationSmartFix(newData, mapping, true, nextManualEditsMap);
    } else {
      processed = processData(newData, mapping, regionRefData, newIgnoredDups, autoFixedMap, nextManualEditsMap, newIgnoredPrice, calculationLogsMap);
      setProcessedData(processed);
    }

    setEditingRowId(null);

    // Persist to DB if session active
    if (currentSessionId) {
      const rowToSync = processed.find(r => r.id === updatedRow.id);
      if (rowToSync) {
        // Log what we are syncing
        console.log('[Sync] Persisting row update to DB:', { id: updatedRow.id, keys: Object.keys(rowToSync.raw || {}) });
        
        authFetch(`/api/sessions/${currentSessionId}/rows/${updatedRow.id + 1}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: rowToSync
          })
        }).catch(err => console.error('Failed to persist row update', err));
      }
    }
  };

  const handleIgnoreDuplicate = (id: number) => {
    const newIgnored = new Set<number>(ignoredDuplicates);
    newIgnored.add(id);
    setIgnoredDuplicates(newIgnored);
    // We use actual current state values instead of undefined/empty maps to ensure highlights persist
    const processed = processData(
      rawData, 
      mapping, 
      regionRefData, 
      ignoredDuplicates, 
      autoFixedMap, 
      manualEditsMap, 
      ignoredPriceWarnings, 
      calculationLogsMap
    );
    setProcessedData(processed);
  };

  const handleIgnorePriceWarning = (id: number) => {
    const newIgnored = new Set<number>(ignoredPriceWarnings);
    newIgnored.add(id);
    setIgnoredPriceWarnings(newIgnored);
    // We use actual current state values instead of undefined/empty maps to ensure highlights persist
    const processed = processData(
      rawData, 
      mapping, 
      regionRefData, 
      ignoredDuplicates, 
      autoFixedMap, 
      manualEditsMap, 
      newIgnored, 
      calculationLogsMap
    );
    setProcessedData(processed);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previousState = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setRawData(previousState);
    // We must pass all current maps to maintain highlights after undo
    const processed = processData(
      previousState, 
      mapping, 
      regionRefData, 
      ignoredDuplicates, 
      autoFixedMap, 
      manualEditsMap, 
      ignoredPriceWarnings, 
      calculationLogsMap
    );
    setProcessedData(processed);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (step === 'review' && history.length > 0) {
          e.preventDefault();
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, history, handleUndo]);

  /**
   * Deletes a row from the dataset.
   * - Updates history.
   * - Shifts indices in edit maps to keep them synchronized.
   */
  const handleDeleteRow = (id: number) => {
    // Save current state to history before deleting
    setHistory(prev => [...prev, JSON.parse(JSON.stringify(rawData))].slice(-20));
    
    const newData = rawData.filter((_, idx) => idx !== id).map((r, i) => ({ ...r, id: i }));
    setRawData(newData);
    
    // Also need to update manualEditsMap and autoFixedMap because indices shifted
    const updateMap = (map: Record<number, any>) => {
      const newMap: Record<number, any> = {};
      Object.entries(map).forEach(([key, value]) => {
        const idx = parseInt(key);
        if (idx < id) newMap[idx] = value;
        if (idx > id) newMap[idx - 1] = value;
      });
      return newMap;
    };
    
    setManualEditsMap(prev => updateMap(prev));
    setAutoFixedMap(prev => updateMap(prev));
    
    const updateSet = (set: Set<number>) => {
      const newSet = new Set<number>();
      set.forEach(idx => {
        if (idx < id) newSet.add(idx);
        if (idx > id) newSet.add(idx - 1);
      });
      return newSet;
    };
    
    setIgnoredDuplicates(prev => updateSet(prev));
    setIgnoredPriceWarnings(prev => updateSet(prev));
    const nextCalcLogs = updateMap(calculationLogsMap);
    setCalculationLogsMap(nextCalcLogs);
    
    const processed = processData(
      newData, 
      mapping, 
      regionRefData, 
      ignoredDuplicates, 
      autoFixedMap, 
      manualEditsMap, 
      ignoredPriceWarnings, 
      nextCalcLogs
    );
    setProcessedData(processed);
    
    if (currentSessionId) {
      handleBulkUpdateRows(processed, true);
    }
    
    setEditingRowId(null);
  };

  const startDuplicateReview = () => {
    const items = processedData.filter(r => r.isDuplicate && r.duplicateOf !== undefined);
    if (items.length === 0) return;
    setReviewQueueType('duplicate');
    setComparingDuplicate({ row1: items[0].duplicateOf!, row2: items[0].id });
  };

  const startPriceReview = () => {
    const items = processedData.filter(r => r.isPriceOutlier && r.priceOutlierRefRowId !== undefined);
    if (items.length === 0) return;
    setReviewQueueType('price');
    setComparingDuplicate({ row1: items[0].priceOutlierRefRowId!, row2: items[0].id });
  };

  useEffect(() => {
    if (!pendingQueueAdvance || !reviewQueueType) return;
    setPendingQueueAdvance(false);
    const items = reviewQueueType === 'duplicate'
      ? processedData.filter(r => r.isDuplicate && r.duplicateOf !== undefined)
      : processedData.filter(r => r.isPriceOutlier && r.priceOutlierRefRowId !== undefined);
    if (items.length > 0) {
      setComparingDuplicate({
        row1: reviewQueueType === 'duplicate' ? items[0].duplicateOf! : items[0].priceOutlierRefRowId!,
        row2: items[0].id,
      });
    } else {
      setReviewQueueType(null);
      setComparingDuplicate(null);
    }
  }, [processedData, pendingQueueAdvance, reviewQueueType]);

  const handleRevalidate = () => {
    setIsAiProcessing(true);
    // Simulate a brief re-validation delay for UX
    setTimeout(() => {
      // Treat current data as the new "original" source of truth
      setOriginalRawData(JSON.parse(JSON.stringify(rawData)));
      
      // Clear edit markers — preserve ignored duplicates and price warnings
      // as those were deliberate user decisions that should survive a re-validate
      setManualEditsMap({});
      setAutoFixedMap({});
      
      // Re-process with cleared markers and run calculations
      const processed = handleCalculationSmartFix(rawData, mapping, true);
      setProcessedData(processed);

      // Sync to backend if session exists
      if (currentSessionId) {
        handleBulkUpdateRows(processed, true);
      }
      
      setIsAiProcessing(false);
    }, 600);
  };

  const handleRevertAiFixes = () => {
    const original = JSON.parse(JSON.stringify(originalRawData));
    setRawData(original);
    setAutoFixedMap({});
    setCalculationLogsMap({});
    setIgnoredDuplicates(new Set());
    setIgnoredPriceWarnings(new Set());
    
    const processed = processData(
      original, 
      mapping, 
      regionRefData, 
      new Set(), 
      {}, 
      {}, 
      new Set(),
      {}
    );
    setProcessedData(processed);

    if (currentSessionId) {
      handleBulkUpdateRows(processed, true);
    }
  };

  /**
   * Performs deterministic calculations and data extractions (Mapping AI).
   * - Calculates Total Quantity from Case Size/Qty
   * - Splits "12 x 75cl" pack strings
   * - Calculates Total Value from Price/Qty
   * - Extracts currency symbols
   */
  const handleCalculationSmartFix = (
    customRawData?: any[], 
    customMapping?: Record<string, string>,
    isAutoTrigger = false,
    overrideManualEdits?: Record<number, string[]>
  ): ProcessedRow[] => {
    const dataToProcess = customRawData || rawData;
    const activeMapping = customMapping || mapping;

    if (dataToProcess.length === 0) return [];
    if (!isAutoTrigger) setIsAiProcessing(true);

    const newData = [...dataToProcess];
    const newAutoFixedMap: Record<number, string[]> = isAutoTrigger ? {} : { ...autoFixedMap };
    const newCalculationLogs: Record<number, Record<string, string>> = isAutoTrigger ? {} : { ...calculationLogsMap };

    newData.forEach((row, idx) => {
      const logs: Record<string, string> = { ...(newCalculationLogs[idx] || {}) };
      const fixedFields: string[] = [...(newAutoFixedMap[idx] || [])];

      // Helper to get value from raw row using mapping
      const getVal = (fieldKey: string) => {
        // Priority 1: Check the schema key itself (manual edits)
        if (row[fieldKey] !== undefined && row[fieldKey] !== null && String(row[fieldKey]).trim() !== '') return row[fieldKey];
        // Priority 2: Check virtual
        if (row[`__ai_calculated_${fieldKey}__`]) return row[`__ai_calculated_${fieldKey}__`];
        // Priority 3: Check mapped
        const header = activeMapping[fieldKey];
        return header ? row[header] : undefined;
      };

      // Helper to set value in raw row using mapping
      const setVal = (fieldKey: string, value: any, log: string) => {
        // Use mapping header if exists, otherwise use a virtual header for unmapped calculations
        const header = activeMapping[fieldKey] || `__ai_calculated_${fieldKey}__`;
        if (header) {
          row[header] = value;
          if (!fixedFields.includes(fieldKey)) fixedFields.push(fieldKey);
          logs[fieldKey] = log;
        }
      };

      // 1. Pack Splitting (e.g. "12 x 75cl")
      // Check if case_size or bottle_size are missing but we have a "pack" or "description" column
      Object.entries(activeMapping).forEach(([fieldKey, header]) => {
        const val = String(row[header] || '');
        const packMatch = val.match(/(\d+)\s*[xX*]\s*(\d+(?:\.\d+)?)\s*(?:cl|ml|L|l)?/i);
        if (packMatch) {
          const size = parseInt(packMatch[1]);
          const vol = packMatch[2];
          
          if (!getVal('case_size')) {
            setVal('case_size', size, `Extracted from '${header}': ${val}`);
          }
          if (!getVal('size')) {
            setVal('size', vol, `Extracted from '${header}': ${val}`);
          }
        }
      });

      // 2. Quantity Calculations
      const caseSize = parseFloat(getVal('case_size'));
      const caseQty = parseFloat(getVal('case_quantity'));
      const totalQty = parseFloat(getVal('total_quantity'));

      if (!isNaN(caseSize) && !isNaN(caseQty) && (isNaN(totalQty) || !getVal('total_quantity')) && dataType !== 'sales_orders' && dataType !== 'purchase_orders') {
        setVal('total_quantity', caseSize * caseQty, `Calculated: Case Size (${caseSize}) × Case Quantity (${caseQty}) = ${caseSize * caseQty}`);
      } else if (!isNaN(totalQty) && !isNaN(caseSize) && (isNaN(caseQty) || !getVal('case_quantity')) && caseSize > 0) {
        setVal('case_quantity', totalQty / caseSize, `Calculated: Total Quantity (${totalQty}) ÷ Case Size (${caseSize}) = ${totalQty / caseSize}`);
      }

      // 3. Financial Calculations
      const priceField = (dataType === 'client_reserves' || dataType === 'purchase_orders') ? 'case_cost_price' : 'exc_vat_case';
      const unitPrice = normalizeCurrency(getVal(priceField)).value;
      const totalValue = normalizeCurrency(getVal('total')).value;
      const qty = parseFloat(getVal('total_quantity')) || totalQty;

      if (unitPrice !== null && !isNaN(qty) && (totalValue === null || !getVal('total'))) {
        setVal('total', unitPrice * qty, `Calculated: Unit Price (${unitPrice}) × Quantity (${qty}) = ${unitPrice * qty}`);
      }

      // 4. Geographical Consistency (Sub-Region -> Region -> Country)
      // REMOVED: Per User Rule D, we no longer auto-correct geography.
      // The system will flag inconsistencies as errors in processData for manual resolution.

      if (fixedFields.length > 0) {
        newAutoFixedMap[idx] = fixedFields;
        newCalculationLogs[idx] = logs;
      }
    });

    setRawData(newData);
    setAutoFixedMap(newAutoFixedMap);
    setCalculationLogsMap(newCalculationLogs);
    const processed = processData(newData, activeMapping, regionRefData, ignoredDuplicates, newAutoFixedMap, overrideManualEdits || manualEditsMap, ignoredPriceWarnings, newCalculationLogs);
    setProcessedData(processed);
    
    if (!isAutoTrigger) setIsAiProcessing(false);
    return processed;
  };

  /**
   * Uses Google Gemini AI to intelligently fix invalid rows.
   * Sends a batch of "red" rows to the model with the schema context.
   * The model returns corrected JSON which is then applied to the data.
   */
  const handleBulkUpdateRows = async (processed: ProcessedRow[], forceAll = false) => {
    if (!currentSessionId) return;
    
    // Only update rows that were actually modified (have autoFixedFields, calculationLogs or manualEdits) or if forcing all
    const rowsToUpdate = processed.filter(r => 
      forceAll ||
      (r.autoFixedFields && r.autoFixedFields.length > 0) || 
      (r.calculationLogs && Object.keys(r.calculationLogs).length > 0) ||
      (r.manualEdits && r.manualEdits.length > 0)
    ).map(r => ({
      rowIndex: r.id,
      content: r
    }));

    if (rowsToUpdate.length === 0) return;

    try {
      await authFetch(`/api/sessions/${currentSessionId}/rows/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rowsToUpdate })
      });
    } catch (error) {
      console.error('Failed bulk update', error);
    }
  };

  const handleAiSmartFix = async () => {
    if (processedData.length === 0) return;
    setIsAiProcessing(true);
    
    // Performance Optimization: Only send "red" status rows (those with errors)
    const rowsToFix = processedData.filter(r => r.status === 'red');
    if (rowsToFix.length === 0) {
      setIsAiProcessing(false);
      return;
    }

    try {
      const currentSchema = getCurrentSchema();
      const summaryList: any[] = [];
      const allFixedResults: any[] = [];

      // Process in larger batches since it's server-side proxy
      const batchSize = 25;
      for (let i = 0; i < rowsToFix.length; i += batchSize) {
        const SENSITIVE_FIELDS = [
          'forename', 'surname', 'email', 'mobile', 'phone', 
          'bank_account_name', 'bank_account_number', 'iban', 'swift'
        ];
        
        if (dataType !== 'inventory' && dataType !== 'client_reserves') {
          SENSITIVE_FIELDS.push('address_line_1', 'address_line_2', 'address_line_3', 'post_code', 'city', 'county', 'address');
        }

        const batch = rowsToFix.slice(i, i + batchSize).map(r => {
          const redactedRaw = { ...r.raw };
          Object.keys(redactedRaw).forEach(header => {
            const mappedField = Object.keys(mapping).find(key => mapping[key] === header);
            const fieldKey = mappedField || header;
            if (SENSITIVE_FIELDS.some(pii => fieldKey.toLowerCase().includes(pii))) {
              redactedRaw[header] = "[REDACTED_PII]";
            }
          });
          return { id: r.id, raw: redactedRaw };
        });

        const res = await authFetch('/api/system/ai-fix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batch,
            fields: currentSchema.fields.map(f => f.key),
            dataType
          })
        });

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          throw new Error(errorData.error || 'AI Fix failed');
        }
        const batchResults = await res.json();
        allFixedResults.push(...batchResults);

        // Build summary for modal
        batchResults.forEach((fixed: any) => {
          const originalRow = processedData.find(r => r.id === fixed.id);
          if (originalRow) {
            const changedFields = Object.keys(fixed).filter(k => k !== 'id' && String(fixed[k]) !== String(originalRow[k]));
            if (changedFields.length > 0) {
              summaryList.push({
                id: fixed.id,
                original: originalRow,
                fixed: fixed,
                fields: changedFields
              });
            }
          }
        });
      }

      setPendingAiChanges(allFixedResults);
      setAiChangesSummary(summaryList);
      setIsAiReviewModalOpen(true);
      
    } catch (error: any) {
      console.error("AI Fix Error:", error);
      alert(error.message || "AI Processing failed. Please try again later.");
    } finally {
      setIsAiProcessing(false);
    }
  };

  const confirmAiFixes = (selectedRowIds?: number[]) => {
    let currentRawData = [...rawData];
    let currentAutoFixedMap = { ...autoFixedMap };
    let currentCalcLogs = { ...calculationLogsMap };
    const currentSchema = getCurrentSchema();

    // If selectedRowIds is provided, only apply those
    const changesToApply = selectedRowIds 
      ? pendingAiChanges.filter(c => selectedRowIds.includes(c.id))
      : pendingAiChanges;

    changesToApply.forEach((fixed: any) => {
      const rowIndex = processedData.findIndex(r => r.id === fixed.id);
      if (rowIndex !== -1) {
        const fieldsFixed: string[] = [];
        const rawRow = { ...currentRawData[fixed.id] };
        const logs: Record<string, string> = { ...(currentCalcLogs[fixed.id] || {}) };
        
        currentSchema.fields.forEach(field => {
          if (fixed[field.key] !== undefined) {
            const currentVal = processedData[rowIndex][field.key];
            if (String(fixed[field.key]) !== String(currentVal)) {
              rawRow[mapping[field.key] || field.key] = fixed[field.key];
              fieldsFixed.push(field.key);
              logs[field.key] = `AI Smart Fix: Moved/Cleaned to '${fixed[field.key]}'`;
            }
          }
        });

        if (fieldsFixed.length > 0) {
          currentRawData[fixed.id] = rawRow;
          currentAutoFixedMap[fixed.id] = Array.from(new Set([...(currentAutoFixedMap[fixed.id] || []), ...fieldsFixed]));
          currentCalcLogs[fixed.id] = logs;
        }
      }
    });

    setRawData(currentRawData);
    setAutoFixedMap(currentAutoFixedMap);
    setCalculationLogsMap(currentCalcLogs);
    
    const processed = processData(
      currentRawData, 
      mapping, 
      regionRefData, 
      ignoredDuplicates, 
      currentAutoFixedMap, 
      manualEditsMap, 
      ignoredPriceWarnings, 
      currentCalcLogs
    );
    
    setProcessedData(processed);
    if (currentSessionId) {
      handleBulkUpdateRows(processed);
    }

    setIsAiReviewModalOpen(false);
    setPendingAiChanges([]);
    setAiChangesSummary([]);
  };

  /**
   * Core Data Processing Engine.
   * Iterates through every row of the raw data and applies:
   * 1. Schema Mapping (Raw Header -> Schema Key)
   * 2. Sanitization (Cleaning strings, numbers, LWINs)
   * 3. Validation (Required fields, Data types, Business logic)
   * 4. Duplicate Detection
   * 
   * @param data The raw data array
   * @param map The current column mapping
   * @param ignoredDups Set of duplicate IDs to ignore
   * @param overrideAutoFixed (Optional) Override for auto-fixed fields map
   * @param overrideManualEdits (Optional) Override for manual edits map
   */
  const processData = (
    data: any[], 
    map: Record<string, string>, 
    refData: any[] = regionRefData,
    ignoredDups?: Set<number>,
    overrideAutoFixed?: Record<number, string[]>,
    overrideManualEdits?: Record<number, string[]>,
    ignoredPrice?: Set<number>,
    overrideCalcLogs?: Record<number, Record<string, string>>
  ): ProcessedRow[] => {
    const currentSchema = getCurrentSchema();
    const seenRows = new Map<string, number>();
    const seenCellarNames = new Map<string, number>();
    const seenCellarCodes = new Map<string, number>();
    const currentIgnored = ignoredDups || ignoredDuplicates;
    const currentIgnoredPrice = ignoredPrice || ignoredPriceWarnings;
    const currentAutoFixed = overrideAutoFixed || autoFixedMap;
    const currentManualEdits = overrideManualEdits || manualEditsMap;
    const currentCalcLogs = overrideCalcLogs || calculationLogsMap;

    const processed = data.map((row, idx) => {
      const result: any = { id: idx, raw: row, status: 'green', errors: [] as string[], fieldErrors: [] as string[] };
      let hasError = false;
      let hasWarning = false;

      // Helper to get mapped value
      const getValue = (key: string) => {
        // Priority 1: Check the schema key itself (this holds manual edits and AI fixes)
        // Manual edits MUST win over AI calculations
        const schemaVal = row[key];
        if (schemaVal !== undefined && schemaVal !== null && String(schemaVal).trim() !== '') return schemaVal;

        // Priority 2: Check virtual calculation field
        const aiCalcVal = row[`__ai_calculated_${key}__`];
        if (aiCalcVal !== undefined && aiCalcVal !== null && String(aiCalcVal).trim() !== '') return aiCalcVal;

        // Priority 3: Check the mapped original header (or constant value)
        const mappedKey = map[key];
        if (mappedKey) {
          if (mappedKey.startsWith('__const__')) return mappedKey.slice(9);
          const val = row[mappedKey];
          if (val !== undefined && val !== null && String(val).trim() !== '') return val;
        }
        
        return '';
      };

      // --- Field-Level Validation Loop ---
      currentSchema.fields.forEach(field => {
        let rawValue = getValue(field.key);
        
        // --- Sanitization: LWIN7 ---
        // LWINs must be strictly numeric and max 7 digits.
        if (field.key === 'lwin7') {
           // Remove non-digits
           let val = String(rawValue || '').replace(/[^0-9]/g, '');
           // Truncate to 7 digits
           if (val.length > 7) val = val.substring(0, 7);
           
           // Update the value in the result
           rawValue = val;
           result[field.key] = val;
           
           // If it was present but invalid (e.g. letters), rawValue is now cleaned.
           // If it's empty after cleaning, it's missing.
        }

        const isMissing = rawValue === undefined || rawValue === null || String(rawValue).trim() === '';

        // --- Validation: Region/Sub-Region against Reference Data ---
        if ((field.key === 'region' || field.key === 'sub_region') && refData.length > 0 && !isMissing) {
           const val = String(rawValue).trim().toLowerCase();
           const rawCountry = getValue('country');
           const country = String(rawCountry || '').trim().toLowerCase();
           
           // Check if value exists in 'Region' column of reference data
           const entry = refData.find(r => r.Region?.toLowerCase() === val);

           if (!entry) {
             result.status = 'red';
             result.errors.push(`Invalid ${field.label}: '${rawValue}'. Not found in reference table.`);
             hasError = true;
             result.fieldErrors.push(field.key);
           } else if (country) {
             // Basic hierarchy check: is the country the parent or grandparent?
             let isMatch = false;
             let current = entry;
             let depth = 0;
             while (current && depth < 5) {
               if (current.Parent?.toLowerCase() === country || current.Region?.toLowerCase() === country) {
                 isMatch = true;
                 break;
               }
               const parentName = current.Parent;
               current = parentName ? refData.find(r => r.Region?.toLowerCase() === parentName.toLowerCase()) : null;
               depth++;
             }

             if (!isMatch) {
               result.status = 'red';
               result.errors.push(`${field.label} '${rawValue}' does not belong to country '${rawCountry}'.`);
               hasError = true;
               result.fieldErrors.push(field.key);
             }
           }
           result[field.key] = rawValue;
        }
        else if (field.key === 'country' && refData.length > 0 && !isMissing) {
           const val = String(rawValue).trim().toLowerCase();
           const isValid = refData.some(r => r.Region?.toLowerCase() === val && r.Type?.toLowerCase() === 'country');
           
           if (!isValid) {
             result.status = 'red';
             result.errors.push(`Invalid Country: '${rawValue}'. Not found in reference table.`);
             hasError = true;
             result.fieldErrors.push(field.key);
           }
           result[field.key] = rawValue;
        }
        
        // --- Validation: Required Fields ---
        else if (field.key === 'lwin7') {
           // LWIN is optional in the schema — format is validated here if present, presence is validated per-row post-loop.
           if (!isMissing && String(rawValue).length !== 7) {
              result.status = 'red';
              result.errors.push(`LWIN7 must be exactly 7 digits.`);
              hasError = true;
              result.fieldErrors.push(field.key);
           }
        } else if (field.required && isMissing) {
          result.status = 'red';
          result.errors.push(`Missing mandatory field: ${field.label}`);
          hasError = true;
          result.fieldErrors.push(field.key);
        }

        // --- Validation: Specific Data Types ---
        
        // Cellar Name: No restriction on special characters
        if (field.key === 'cellar_name' && dataType === 'cellars') {
           result[field.key] = String(rawValue || '');
        }
        // Currency: 3 or 4 letter code
        else if (field.key === 'currency' && dataType === 'cellars') {
           const val = String(rawValue || '').toUpperCase().trim();
           if ((val.length < 3 || val.length > 4) && !isMissing) {
              result.status = 'red';
              result.errors.push(`Invalid Currency Code: ${rawValue}. Must be 3 or 4 letters (e.g. GBP, EUR)`);
              hasError = true;
              result.fieldErrors.push(field.key);
           }
           result[field.key] = val;
        }
        // Create as customer cellar: Y/N
        else if (field.key === 'create_as_customer_cellar' && dataType === 'cellars') {
           let val = String(rawValue || '').toUpperCase().trim();
           if (val === 'YES') val = 'Y';
           if (val === 'NO') val = 'N';
           
           if (val !== 'Y' && val !== 'N' && !isMissing) {
              result.status = 'red';
              result.errors.push(`Invalid value for ${field.label}: ${rawValue}. Must be Y or N.`);
              hasError = true;
              result.fieldErrors.push(field.key);
           }
           result[field.key] = val;
        }
        // Vintage: Year (1900-2026) or 'NV'
        else if (field.key === 'vintage') {
          const normVintage = normalizeVintage(rawValue);
          if (normVintage === 'INVALID') {
            result[field.key] = rawValue; 
            result.status = 'red';
            result.errors.push(`Invalid vintage: ${rawValue}. Must be YYYY, NV, or 1`);
            hasError = true;
            result.fieldErrors.push(field.key);
          } else {
            result[field.key] = normVintage;
          }
        } 
        // Bottle Size: Standardized to Centiliters (cl)
        else if (field.key === 'size') {
          const normSize = normalizeBottleSize(rawValue);
          if (normSize === null && !isMissing) {
            result[field.key] = rawValue; 
            result.status = 'red';
            result.errors.push(`Invalid size format: ${rawValue}. Must be in cl (e.g. 75cl)`);
            hasError = true;
            result.fieldErrors.push(field.key);
          } else {
            result[field.key] = normSize;
          }
        }
        // Wine Names: Check for special characters (allowing Unicode letters/accents and standard/curly apostrophes)
        else if (field.key === 'listing_wine_name' || field.key === 'display_wine_name') {
           const strVal = String(rawValue || '');
           // Allowed: letters (including accents), numbers, space, hyphen, dot, comma, apostrophes (standard & curly), parens, ampersand, percent.
           if (/[^\p{L}0-9\s.,'’()&%-]/u.test(strVal)) {
              result.status = 'red';
              result.errors.push(`Wine name contains special characters: ${strVal}`);
              hasError = true;
              result.fieldErrors.push(field.key);
           }
           result[field.key] = strVal;
        }
        // Case Size: 1-36
        else if (field.key === 'case_size') {
           const val = parseInt(String(rawValue || '0'), 10);
           if (!isNaN(val)) {
             if (val < 1 || val > 36) {
               result.status = 'red';
               result.errors.push(`Case size must be between 1 and 36. Found: ${val}`);
               hasError = true;
               result.fieldErrors.push(field.key);
             }
             result[field.key] = val;
           } else if (!isMissing) {
             result.status = 'red';
             result.errors.push(`Invalid case size: ${rawValue}`);
             hasError = true;
             result.fieldErrors.push(field.key);
           }
        }
        // Tax Status: IB or DP only
        else if (field.key === 'tax_status') {
           const val = String(rawValue || '').toUpperCase().trim();
           if (val !== 'IB' && val !== 'DP' && !isMissing) {
             result.status = 'red';
             result.errors.push(`Tax Status must be 'IB' or 'DP'. Found: ${rawValue}`);
             hasError = true;
             result.fieldErrors.push(field.key);
           }
           result[field.key] = val;
        }
        // Wine Type: Fuzzy matching against known types
        else if (field.key === 'type') {
           const val = String(rawValue || '').trim();
           if (val) {
             const exactMatch = WINE_TYPES.find(t => t.toLowerCase() === val.toLowerCase());
             if (exactMatch) {
               result[field.key] = exactMatch; // Normalize
             } else {
               const closest = findClosestMatch(val, WINE_TYPES);
               if (closest) {
                 result.status = 'yellow';
                 result.errors.push(`Invalid Type '${val}'. Did you mean '${closest}'?`);
               } else {
                 result.status = 'red';
                 result.errors.push(`Invalid Type '${val}'. Must be one of: ${WINE_TYPES.join(', ')}`);
                 hasError = true;
                 result.fieldErrors.push(field.key);
               }
               result[field.key] = val;
             }
           } else {
             result[field.key] = val;
           }
        }
        // Sub-Type: Validated against Type
        else if (field.key === 'sub_type') {
           const val = String(rawValue || '').trim();
           const currentType = result['type']; 

           if (val) {
             const exactMatch = WINE_SUBTYPES.find(t => t.toLowerCase() === val.toLowerCase());
             let normalizedSubType = val;

             if (exactMatch) {
               normalizedSubType = exactMatch;
               result[field.key] = exactMatch; 
             } else {
               const closest = findClosestMatch(val, WINE_SUBTYPES);
               if (closest) {
                 result.status = 'yellow';
                 result.errors.push(`Invalid Sub-Type '${val}'. Did you mean '${closest}'?`);
               } else {
                 result.status = 'red';
                 result.errors.push(`Invalid Sub-Type '${val}'. Must be one of: ${WINE_SUBTYPES.join(', ')}`);
                 hasError = true;
                 result.fieldErrors.push(field.key);
               }
               result[field.key] = val;
             }

             // Check if Sub-Type is valid for the selected Type
             if (currentType && TYPE_TO_SUBTYPE[currentType]) {
                const allowedSubTypes = TYPE_TO_SUBTYPE[currentType];
                const isAllowed = allowedSubTypes.some(st => st.toLowerCase() === normalizedSubType.toLowerCase());

                if (!isAllowed) {
                   result.status = 'red';
                   result.errors.push(`Sub-Type '${normalizedSubType}' is not valid for Type '${currentType}'. Allowed: ${allowedSubTypes.join(', ')}`);
                   hasError = true;
                   result.fieldErrors.push(field.key);
                }
             }
           } else {
             result[field.key] = val;
           }
        }
        // Cellar Name: Check against valid list
        else if (field.key === 'cellar_name') {
           const val = String(rawValue || '').trim();
           result[field.key] = val;
        }
        // Dates: Normalize to dd/mm/yyyy
        else if (field.key.includes('date') || field.key.endsWith('_on')) {
           const normDate = normalizeDate(rawValue);
           if (normDate) {
              result[field.key] = normDate;
           } else if (!isMissing) {
              result[field.key] = rawValue;
              result.status = 'red';
              result.errors.push(`Invalid date format: ${rawValue}. Must be dd/mm/yyyy`);
              hasError = true;
              result.fieldErrors.push(field.key);
           }
        }
        // Generic Options Validation
        else if (field.options) {
          const val = String(rawValue || '').trim();
          const cleanVal = val.replace(/\.$/, '');
          const isValid = field.options.some(opt => 
            opt.toLowerCase() === val.toLowerCase() || 
            opt.replace(/\.$/, '').toLowerCase() === cleanVal.toLowerCase()
          );
          
          if (!isValid && !isMissing) {
            result.status = 'red';
            result.errors.push(`Invalid ${field.label}: '${val}'. Please select from the accepted list.`);
            hasError = true;
            result.fieldErrors.push(field.key);
          }
          result[field.key] = val;
        }
        // Email Validation
        else if (field.key === 'email' || field.key === 'main_contact_email') {
           const val = String(rawValue || '').trim();
           if (!isMissing) {
             const atCount = (val.match(/@/g) || []).length;
             if (atCount !== 1 || val.includes(' ')) {
               result.status = 'red';
               result.errors.push(`Invalid email: '${val}'. Must contain exactly one @ and no spaces.`);
               hasError = true;
               result.fieldErrors.push(field.key);
             }
           }
           result[field.key] = val;
        }
        else if (field.key === 'address_line_1' || field.key === 'address_line_2' || field.key === 'address_line_3') {
           const val = String(rawValue || '').trim();
           if (!isMissing && /[^\p{L}0-9\s,\-.'\/#&()""]/u.test(val)) {
             result.status = 'red';
             result.errors.push(`${field.label} contains invalid characters: '${val}'`);
             hasError = true;
             result.fieldErrors.push(field.key);
           }
           result[field.key] = val;
        }
        else if (field.key === 'city') {
           const val = String(rawValue || '').trim();
           if (!isMissing && /[^\p{L}\s\-''.]/u.test(val)) {
             result.status = 'red';
             result.errors.push(`City contains invalid characters: '${val}'`);
             hasError = true;
             result.fieldErrors.push(field.key);
           } else {
             const countryVal = String(getValue('country') || '').trim();
             if (countryVal && val.toLowerCase().includes(countryVal.toLowerCase()) && !isMissing) {
               result.status = 'yellow';
               result.errors.push(`City name '${val}' should not contain Country name '${countryVal}'`);
               hasWarning = true;
             }
           }
           result[field.key] = val;
        }
        else if (field.key === 'country') {
           const val = String(rawValue || '').trim();
           const cityVal = String(getValue('city') || '').trim();
           const countyVal = String(getValue('county') || '').trim();
           
           if ((cityVal && val.toLowerCase().includes(cityVal.toLowerCase())) || 
               (countyVal && val.toLowerCase().includes(countyVal.toLowerCase()))) {
              if (!isMissing) {
                result.status = 'yellow';
                result.errors.push(`Country name '${val}' should not contain City/County name`);
                hasWarning = true;
              }
           }
           result[field.key] = val;
        }
        else if (field.key === 'phone' || field.key === 'mobile') {
           let val = String(rawValue || '').trim();
           // Remove alphabets and special chars, keep leading 0, maybe keep +?
           // User said "Avoid alphabets and special characters", "ensure you are not losing the leading 0"
           // Assuming we keep digits and maybe spaces/plus for readability, but strictly user said avoid special chars.
           // Let's strip everything except digits.
           const original = val;
           val = val.replace(/[^0-9]/g, '');
           if (val !== original && !isMissing) {
              // If we stripped something, maybe we should warn or just autofix?
              // User said "Avoid alphabets... ensure not losing leading 0".
              // If original was "+44 123", new is "44123". Leading 0 might be lost if it was parsed as number before.
              // But rawValue comes from file. If CSV/Excel, leading 0 might be gone already if not careful.
              // We can't restore lost leading 0 easily without knowing locale.
              // But we can ensure we don't strip it if it's there.
              result.autoFixedFields = [...(result.autoFixedFields || []), field.key];
           }
           result[field.key] = val;
        }
        else if (field.key === 'forename' || field.key === 'surname') {
           const val = String(rawValue || '').trim();
           if (!isMissing && /[^\p{L}\s\-''.]/u.test(val)) {
             result.status = 'red';
             result.errors.push(`${field.label} contains invalid characters: '${val}'`);
             hasError = true;
             result.fieldErrors.push(field.key);
           } else {
             const suspicious = ['company', 'ltd', 'limited', 'plc', 'mr', 'mrs', 'miss', 'dr', 'sir'];
             const found = suspicious.find(s => new RegExp(`\\b${s}\\b`, 'i').test(val));
             if (found && !isMissing) {
               result.status = 'yellow';
               result.errors.push(`Possible invalid name (contains '${found}'). Ensure no company names or salutations.`);
               hasWarning = true;
             }
           }
           result[field.key] = val;
        }
        else if (field.key === 'currency') {
           // Mandatory check is already done.
           // Just ensure it's a valid currency code? User didn't specify list, just "assigned to it".
           // "Usually when empty this is your default Currency e.g. GBP"
           // Since we marked it required=true, the empty check handles it.
           result[field.key] = rawValue;
        }
        else if (field.key === 'cost' || field.key === 'total' || field.key === 'price' || field.key.startsWith('exc_vat') || field.key === 'case_cost_price' || field.key === 'case_selling_price') {
          const normPrice = normalizeCurrency(rawValue);
          if (normPrice.value === null && !isMissing) {
            result[field.key] = rawValue; // Keep original value
            result.status = 'red';
            result.errors.push(`Invalid price format for ${field.label}: ${rawValue}`);
            hasError = true;
            result.fieldErrors.push(field.key);
          } else {
            result[field.key] = normPrice.value;
          }
        } 
        else if (['abv', 'case_size', 'case_quantity', 'total_quantity', 'exchange_rate'].includes(field.key)) {
          const val = parseFloat(String(rawValue).replace(/[^0-9.]/g, ''));
          result[field.key] = isNaN(val) ? (isMissing ? '' : rawValue) : val;
          if (isNaN(val) && !isMissing) {
            result.status = 'red';
            result.errors.push(`Invalid numeric format for ${field.label}: ${rawValue}`);
            hasError = true;
            result.fieldErrors.push(field.key);
          }
        }
        // Account code / cellar code: letters, digits, spaces, hyphens, underscores, slashes, dots
        else if (field.key === 'account_code' || field.key === 'cellar_code') {
           const val = String(rawValue || '').trim();
           if (!isMissing && /[^A-Za-z0-9\s\-_\/.]/.test(val)) {
             result.status = 'red';
             result.errors.push(`${field.label} contains invalid characters: '${val}'`);
             hasError = true;
             result.fieldErrors.push(field.key);
           }
           result[field.key] = val;
        }
        // County: letters, spaces, hyphens, apostrophes, dots
        else if (field.key === 'county') {
           const val = String(rawValue || '').trim();
           if (!isMissing && /[^\p{L}\s\-''.]/u.test(val)) {
             result.status = 'red';
             result.errors.push(`County contains invalid characters: '${val}'`);
             hasError = true;
             result.fieldErrors.push(field.key);
           }
           result[field.key] = val;
        }
        // Company name: letters, digits, spaces, common business punctuation
        else if (field.key === 'company_name') {
           const val = String(rawValue || '').trim();
           if (!isMissing && /[^\p{L}0-9\s\-.,''()&\/]/u.test(val)) {
             result.status = 'red';
             result.errors.push(`Company Name contains invalid characters: '${val}'`);
             hasError = true;
             result.fieldErrors.push(field.key);
           }
           result[field.key] = val;
        }
        // Cellar name: letters, digits, spaces, hyphens, commas, apostrophes, dots
        else if (field.key === 'cellar_name') {
           const val = String(rawValue || '').trim();
           if (!isMissing && /[^\p{L}0-9\s\-,.']/u.test(val)) {
             result.status = 'red';
             result.errors.push(`Cellar Name contains invalid characters: '${val}'`);
             hasError = true;
             result.fieldErrors.push(field.key);
           }
           result[field.key] = val;
        }
        // Supplier name: same rules as company name
        else if (field.key === 'supplier_name') {
           const val = String(rawValue || '').trim();
           if (!isMissing && /[^\p{L}0-9\s\-.,''()&\/]/u.test(val)) {
             result.status = 'red';
             result.errors.push(`Supplier contains invalid characters: '${val}'`);
             hasError = true;
             result.fieldErrors.push(field.key);
           }
           result[field.key] = val;
        }
        // PO number: alphanumeric plus hyphens, underscores, slashes, dots
        else if (field.key === 'po_number') {
           const val = String(rawValue || '').trim();
           if (!isMissing && /[^A-Za-z0-9\s\-_\/.]/.test(val)) {
             result.status = 'red';
             result.errors.push(`PO Number contains invalid characters: '${val}'`);
             hasError = true;
             result.fieldErrors.push(field.key);
           }
           result[field.key] = val;
        }
        // Post code: letters, digits, spaces, hyphens
        else if (field.key === 'post_code') {
           const val = String(rawValue || '').trim();
           if (!isMissing && /[^A-Za-z0-9\s\-]/.test(val)) {
             result.status = 'red';
             result.errors.push(`Post Code contains invalid characters: '${val}'`);
             hasError = true;
             result.fieldErrors.push(field.key);
           }
           result[field.key] = val;
        }
        else {
          result[field.key] = rawValue || '';
        }
      });

      // Post-loop LWIN Validation
      if (dataType === 'inventory' || dataType === 'client_reserves' || dataType === 'sales_orders' || dataType === 'purchase_orders') {
        const lwinVal = result['lwin7'];
        const isLwinMissing = !lwinVal || String(lwinVal).trim() === '';

        if (isLwinMissing) {
            const isFieldPresent = (key: string) => {
               const val = result[key];
               return val !== undefined && val !== null && String(val).trim() !== '';
            };

            const missingFields: string[] = [];
            if (!isFieldPresent('listing_wine_name') && !isFieldPresent('display_wine_name')) missingFields.push('Wine Name');
            if (!isFieldPresent('producer')) missingFields.push('Producer');
            if (!isFieldPresent('vintage')) missingFields.push('Vintage');
            if (!isFieldPresent('country')) missingFields.push('Country');
            if (!isFieldPresent('region')) missingFields.push('Region');

            if (missingFields.length > 0) {
               result.status = 'red';
               const msg = `No LWIN — required fields missing: ${missingFields.join(', ')}`;
               if (!result.errors.includes(msg)) result.errors.push(msg);
               hasError = true;
               result.fieldErrors.push('lwin7');
            }
        }
      }

      // --- Master Data Validation ---
      if ((dataType === 'inventory' || dataType === 'client_reserves' || dataType === 'sales_orders' || dataType === 'purchase_orders') && result['cellar_name']) {
        const cellarName = String(result['cellar_name']).trim();
        if (masterCellars.length > 0 && !masterCellars.includes(cellarName)) {
          result.status = 'red';
          result.errors.push(`Cellar '${cellarName}' not found in Master List. Please load Cellars first.`);
          hasError = true;
          result.fieldErrors.push('cellar_name');
        }
      }

      if ((dataType === 'client_reserves' || dataType === 'sales_orders' || dataType === 'purchase_orders') && result['account_code']) {
        const accountCode = String(result['account_code']).trim();
        if (masterClients.length > 0 && !masterClients.includes(accountCode)) {
          result.status = 'red';
          result.errors.push(`Account Code '${accountCode}' not found. Please load Private Clients, Trade Clients, or Suppliers lists first.`);
          hasError = true;
          result.fieldErrors.push('account_code');
        }
      }

      // --- Duplicate Detection ---
      // Create a unique fingerprint for the row based on key fields.
      // If the fingerprint is seen before, mark as duplicate.
      let duplicateFingerprint = '';
      if (dataType === 'contacts' || dataType === 'private_clients' || dataType === 'trade_clients' || dataType === 'suppliers') {
         duplicateFingerprint = String(result['account_code'] || '').trim();
      } else if (dataType === 'cellars') {
         // Check for unique cellar name and cellar code
         const name = String(result['cellar_name'] || '').trim().toLowerCase();
         const code = String(result['cellar_code'] || '').trim().toLowerCase();
         
         if (name && seenCellarNames.has(name) && !currentIgnored.has(idx)) {
            result.status = 'red';
            result.errors.push(`Duplicate Cellar Name detected: ${result['cellar_name']}`);
            hasError = true;
            result.fieldErrors.push('cellar_name');
         } else if (name) {
            seenCellarNames.set(name, idx);
         }

         if (code && seenCellarCodes.has(code) && !currentIgnored.has(idx)) {
            result.status = 'red';
            result.errors.push(`Duplicate Cellar Code detected: ${result['cellar_code']}`);
            hasError = true;
            result.fieldErrors.push('cellar_code');
         } else if (code) {
            seenCellarCodes.set(code, idx);
         }
         
         // Use combined fingerprint for general duplicate detection if needed, 
         // but name/code uniqueness is more specific here.
         duplicateFingerprint = `${name}|${code}`;
      } else if (dataType === 'inventory' || dataType === 'client_reserves') {
         const fields = ['lwin7', 'vintage', 'case_size', 'size', 'tax_status', 'case_quantity', 'total_quantity', 'rotation_number'];
         if (dataType === 'client_reserves') fields.push('account_code');
         duplicateFingerprint = fields.map(k => String(result[k] || '')).join('|');
      } else if (dataType === 'sales_orders') {
         duplicateFingerprint = ['so_number', 'lwin7', 'vintage', 'case_size', 'size']
          .map(k => String(result[k] || '')).join('|');
      } else if (dataType === 'purchase_orders') {
         duplicateFingerprint = ['po_number', 'lwin7', 'vintage', 'case_size', 'size']
          .map(k => String(result[k] || '')).join('|');
      } else {
         duplicateFingerprint = ['lwin7', 'vintage', 'case_size', 'size', 'tax_status']
          .map(k => String(result[k] || '')).join('|');
      }
      
      // For client_reserves: if account_code is missing we can't assert per-client uniqueness, so skip.
      const skipDuplicateCheck = dataType === 'client_reserves' && !String(result['account_code'] || '').trim();

      if (!skipDuplicateCheck && seenRows.has(duplicateFingerprint) && !currentIgnored.has(idx)) {
        result.isDuplicate = true;
        result.duplicateOf = seenRows.get(duplicateFingerprint);
        if (dataType === 'contacts' || dataType === 'private_clients' || dataType === 'trade_clients' || dataType === 'suppliers') {
           result.errors.push(`Duplicate Account Code detected: ${duplicateFingerprint}`);
        } else if (dataType === 'inventory') {
           result.errors.push('Suspect duplicate detected (Same LWIN, Vintage, Size, Tax, Quantities, Rot #)');
        } else if (dataType === 'client_reserves') {
           result.errors.push('Suspect duplicate detected (Same Account Code, LWIN, Vintage, Size, Tax, Quantities, Rot #)');
        } else if (dataType === 'sales_orders') {
           result.errors.push('Suspect duplicate detected (Same SO Number, LWIN, Vintage, Case Size, Bottle Size)');
        } else if (dataType === 'purchase_orders') {
           result.errors.push('Suspect duplicate detected (Same PO Number, LWIN, Vintage, Case Size, Bottle Size)');
        } else {
           result.errors.push('Suspect duplicate detected (Same LWIN, Vintage, Size, Tax Status)');
        }
        hasWarning = true; // Duplicates are warnings unless they also have errors
      } else if (!skipDuplicateCheck) {
        seenRows.set(duplicateFingerprint, idx);
      }

      // --- Status Assignment (Preliminary) ---
      if (hasError) result.status = 'red';
      else if (hasWarning || result.isDuplicate) result.status = 'yellow';
      else result.status = 'green';

      // --- Apply Overrides ---
      if (currentAutoFixed[idx]) {
        result.autoFixedFields = currentAutoFixed[idx];
      }
      if (currentManualEdits[idx]) {
        result.manualEdits = currentManualEdits[idx];
      }
      if (currentCalcLogs[idx]) {
        result.calculationLogs = currentCalcLogs[idx];
      }

      return result;
    });

    // --- Price Anomaly Detection (Inventory and Client Reserves Only) ---
    if (dataType === 'inventory' || dataType === 'client_reserves') {
      // 1. Collect Valid Unit Prices
      // Unit Price = exc_vat_case / case_size (or case_cost_price for client_reserves)
      // We only consider rows that have valid numeric values for these fields
      const validPrices: number[] = [];
      const rowPrices = new Map<number, number>(); // Map row ID to calculated unit price
      const groupedPrices = new Map<string, { total: number, count: number, prices: number[], rowIds: number[] }>(); // Group by LWIN+Vintage
      const priceToRowId = new Map<number, number>(); // Map unit price back to row ID (for median reference)

      processed.forEach(row => {
        const priceField = dataType === 'client_reserves' ? 'case_cost_price' : 'exc_vat_case';
        const price = parseFloat(row[priceField]);
        const caseSize = parseInt(row['case_size']);
        const size = parseFloat(row['size']); // Bottle size in cl, e.g. 75

        // Basic validity check for price calculation
        if (!isNaN(price) && !isNaN(caseSize) && caseSize > 0 && price > 0) {
           // Calculate normalized price per bottle (unit price)
           // If we want to be super precise, we divide by (case_size * size). 
           // But usually "Unit Price" implies "Price per Bottle" in the trade context, assuming standard 75cl.
           // If sizes vary (magnums vs halves), we MUST normalize by volume.
           // Let's normalize to "Price per 75cl Bottle Equivalent".
           // Formula: (Price / CaseSize) * (75 / Size)
           // Example: Case of 6 Magnums (150cl) for £600.
           // Price per bottle (Magnum) = £100.
           // Price per 75cl equiv = £100 * (75/150) = £50.
           
           let unitPrice = price / caseSize;
           if (!isNaN(size) && size > 0) {
              unitPrice = unitPrice * (75 / size);
           }
           
           validPrices.push(unitPrice);
           rowPrices.set(row.id, unitPrice);
           priceToRowId.set(unitPrice, row.id);

           // Grouping for Consistency Check
           // Key: LWIN7 + Vintage (or Name + Vintage if LWIN missing)
           const key = `${row['lwin7'] || row['listing_wine_name'] || 'unknown'}_${row['vintage']}`;
           if (!groupedPrices.has(key)) {
             groupedPrices.set(key, { total: 0, count: 0, prices: [], rowIds: [] });
           }
           const group = groupedPrices.get(key)!;
           group.total += unitPrice;
           group.count += 1;
           group.prices.push(unitPrice);
           group.rowIds.push(row.id);
        }
      });

      if (validPrices.length > 0) {
        // 2. Global Outlier Detection
        // "if all the stuff is around X gbp, why one specific line is x times 50?"
        // Calculate Median
        validPrices.sort((a, b) => a - b);
        const mid = Math.floor(validPrices.length / 2);
        const medianPrice = validPrices.length % 2 !== 0 ? validPrices[mid] : (validPrices[mid - 1] + validPrices[mid]) / 2;
        const medianRowId = priceToRowId.get(validPrices[mid]);

        // Threshold: > 50x Median (User said "x times 50", taking it literally as a heuristic for massive error)
        // Also check for extremely low prices? < Median / 50?
        const highThreshold = medianPrice * 50;
        
        // 3. Apply Checks
        processed.forEach(row => {
           if (currentIgnoredPrice.has(row.id)) return;
           
           const unitPrice = rowPrices.get(row.id);
           if (unitPrice !== undefined) {
              // Check Global Outlier
              if (unitPrice > highThreshold) {
                 if (row.status !== 'red') row.status = 'yellow';
                 row.errors.push(`Potential Price Error: Value is significantly higher (>50x) than dataset median.`);
                 row.isPriceOutlier = true;
                 row.priceOutlierType = 'global';
                 row.priceOutlierRef = medianPrice;
                 row.priceOutlierRefRowId = medianRowId;
              }

              // Check Group Consistency
              // "if two same product and same vintage cost around a price, why the third one... costs much more or much less?"
              const key = `${row['lwin7'] || row['listing_wine_name'] || 'unknown'}_${row['vintage']}`;
              const group = groupedPrices.get(key);
              
              if (group && group.count >= 3) {
                 // We have enough data points to compare
                 const avgPrice = group.total / group.count;
                 
                 // If this specific row deviates significantly from the group average
                 // Threshold: > 2x Average or < 0.5x Average (User said "much more or much less")
                 if (unitPrice > avgPrice * 2) {
                    if (row.status !== 'red') row.status = 'yellow';
                    row.errors.push(`Price Inconsistency: Significantly higher than other entries for this wine.`);
                    row.isPriceOutlier = true;
                    row.priceOutlierType = 'high';
                    row.priceOutlierRef = avgPrice;
                    row.priceOutlierRefRowId = group.rowIds.find(id => id !== row.id);
                 } else if (unitPrice < avgPrice * 0.5) {
                    if (row.status !== 'red') row.status = 'yellow';
                    row.errors.push(`Price Inconsistency: Significantly lower than other entries for this wine.`);
                    row.isPriceOutlier = true;
                    row.priceOutlierType = 'low';
                    row.priceOutlierRef = avgPrice;
                    row.priceOutlierRefRowId = group.rowIds.find(id => id !== row.id);
                 }
              }
           }
        });
      }
    }

    setProcessedData(processed);
    return processed;
  };

  const handleDownloadTemplate = async () => {
    const fields = SCHEMAS[dataType].fields;
    
    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Template');

    // Add headers
    const headerRow = worksheet.addRow(fields.map(f => f.label));

    // Style headers
    headerRow.eachCell((cell, colNumber) => {
      const field = fields[colNumber - 1];
      
      // Basic styling for all headers
      cell.font = { bold: true };
      cell.border = {
        bottom: { style: 'thin' }
      };

      // Highlight mandatory fields
      if (field.required) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFE0B2' } // Light Orange/Yellow (Tailwind Orange-100 approx)
        };
        // Add a note or comment if possible, or just rely on color
        cell.note = 'Mandatory Field';
      }
    });

    // Adjust column widths
    worksheet.columns.forEach(column => {
      column.width = 20;
    });

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    
    // Create blob and download
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${dataType}_template.xlsx`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getActiveSessionForType = (type: DataType) => {
    return sessions.find(s => {
      if (s.status === 'completed' || s.disabled === 1) return false;
      try {
        const rawFields = (s as any).fields;
        const fields = rawFields ? (typeof rawFields === 'string' ? JSON.parse(rawFields) : rawFields) : {};
        if (fields.dataType === type) return true;
      } catch (e) {}
      return s.session_type && s.session_type.split(':')[0] === type;
    });
  };

  const getCompletedSessionForType = (type: DataType) => {
    return sessions.find(s => {
      if (s.status !== 'completed' || s.disabled === 1) return false;
      try {
        const rawFields = (s as any).fields;
        const fields = rawFields ? (typeof rawFields === 'string' ? JSON.parse(rawFields) : rawFields) : {};
        if (fields.dataType === type) return true;
      } catch (e) {}
      return s.session_type && s.session_type.split(':')[0] === type;
    });
  };

  const handleStartNew = async (idOrEvent?: number | React.MouseEvent, typeOverride?: DataType) => {
    // Handle polymorphic arguments correctly
    const specificSessionId = typeof idOrEvent === 'number' ? idOrEvent : undefined;
    
    // We determine the target type either from the argument (card click) or current state (header button click)
    const targetDataType = typeOverride || dataType;
    
    console.log('[App] handleStartNew triggered', { specificSessionId, targetDataType });
    
    // 1. Determine which session we are archiving. 
    let sessionIdToArchive = specificSessionId || currentSessionId;
    
    // If no ID was passed and we don't have a global currentSessionId, look it up from the sessions list
    if (!sessionIdToArchive && targetDataType) {
      const activeSession = getActiveSessionForType(targetDataType);
      if (activeSession) {
        sessionIdToArchive = activeSession.id;
        console.log('[App] Found active session to archive:', sessionIdToArchive);
      }
    }
    
    if (sessionIdToArchive) {
      try {
        console.log('[App] Archiving session in DB:', sessionIdToArchive);
        const resp = await authFetch(`/api/sessions/${sessionIdToArchive}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disabled: 1, status: 'abandoned' })
        });
        
        if (!resp.ok) {
          const errorText = await resp.text();
          console.error('[App] Server-side archive failed:', resp.status, errorText);
        } else {
          console.log('[App] Server-side archive successful');
        }
      } catch (err) {
        console.error('[App] Network error archiving session:', err);
      }
    } else {
      console.log('[App] No session found to archive for type:', targetDataType);
    }

    // --- Reset ALL local state to ensure a clean slate ---
    console.log('[App] Resetting all local UI state...');
    
    // 1. Clear completion flag for this specific type
    if (targetDataType) {
      const newCompleted = { ...completedTasks };
      if (newCompleted[targetDataType]) {
        console.log('[StartNew] Clearing completed flag for:', targetDataType);
        delete newCompleted[targetDataType];
        setCompletedTasks(newCompleted);
        localStorage.setItem(completedStorageKey, JSON.stringify(newCompleted));
      }
    }

    // 2. Clear sessions locally immediately to feel faster
    if (sessionIdToArchive) {
      setSessions(prev => prev.filter(s => String(s.id) !== String(sessionIdToArchive)));
    }
    
    // 3. Global state UI reset
    setStep('upload');
    setRawData([]);
    setOriginalRawData([]);
    setHeaders([]);
    setMapping({});
    setProcessedData([]);
    setAutoFixedMap({});
    setManualEditsMap({});
    setCalculationLogsMap({});
    setIgnoredDuplicates(new Set());
    setIgnoredPriceWarnings(new Set());
    setHasAutoFixed(false);
    setShowOnlyErrors(false);
    setShowOnlyEdited(false);
    setCurrentSessionId(null);
    setFileName('');
    setDataType(targetDataType || 'inventory'); // Preserve the intended data type
    setIsRulesModalOpen(false);
    setOpenCompletedDropdown(null);
    setValidationError(null);
    setEditingRowId(null);
    setHistory([]);
    
    // Final refresh to ensure UI reflects DB state
    await loadSessions(); 
    console.log('[App] handleStartNew finished successfully');
  };

  const renderDataTypeButton = (type: DataType) => {
    const isCompleted = !!completedTasks[type];
    const activeSession = getActiveSessionForType(type);
    const isInProgress = !!activeSession;

    return (
      <div key={type} className="relative group/btn">
        <button
          onClick={() => { 
            if (isInProgress || isCompleted) {
              setOpenCompletedDropdown(openCompletedDropdown === type ? null : type);
              setDataType(type);
              setValidationError(null);
            } else {
              setDataType(type); 
              setValidationError(null); 
              setOpenCompletedDropdown(null);
            }
          }}
          className={`px-6 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all border flex items-center gap-2 ${
            dataType === type 
              ? (isInProgress
                  ? 'bg-amber-500 text-white border-amber-500 shadow-lg scale-105'
                  : isCompleted 
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-lg scale-105' 
                    : 'bg-black text-white border-black shadow-lg scale-105')
              : (isInProgress
                  ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 shadow-sm'
                  : isCompleted 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' 
                    : 'bg-white text-black/40 border-black/5 hover:border-black/20')
          }`}
        >
          {isCompleted && !isInProgress && <CheckCircle2 size={12} />}
          {isInProgress && <RefreshCcw size={12} className="animate-spin-slow" />}
          {SCHEMAS[type]?.label || type}
          {isInProgress && (
            <span className="ml-1 text-[8px] font-black opacity-60">RESUME</span>
          )}
          {((type === 'cellars' && masterCellars.length > 0) || (['contacts', 'private_clients', 'trade_clients', 'suppliers'].includes(type) && masterClients.length > 0)) && (
            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${isInProgress ? 'bg-amber-400' : 'bg-emerald-500'}`} />
          )}
        </button>

        {openCompletedDropdown === type && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-black/5 p-2 z-50 animate-in fade-in slide-in-from-top-2">
            {isInProgress && (
              <button
                onClick={() => handleLoadSession(activeSession.id)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 hover:bg-amber-50 rounded-xl transition-colors mb-1"
              >
                <RefreshCcw size={14} />
                Resume Progress
              </button>
            )}
            
            {isCompleted && !isInProgress && (() => {
              const cs = getCompletedSessionForType(type);
              return cs ? (
                <button
                  onClick={() => handleReopenSession(cs.id, type)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors mb-1"
                >
                  <Play size={14} />
                  Reopen Session
                </button>
              ) : null;
            })()}

            {isCompleted && (
              <button
                onClick={() => handleExportCompleted(type)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 hover:bg-emerald-50 rounded-xl transition-colors mb-1"
              >
                <Download size={14} />
                Export Last
              </button>
            )}

            <button
              onClick={() => handleStartNew(activeSession?.id, type)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
            >
              <Plus size={14} />
              Start New
            </button>
          </div>
        )}

        {((type === 'cellars' && masterCellars.length > 0) || (['contacts', 'private_clients', 'trade_clients', 'suppliers'].includes(type) && masterClients.length > 0)) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClearMasterData(type === 'cellars' ? 'cellars' : 'contacts');
            }}
            className="absolute -top-2 -right-2 p-1.5 bg-rose-500 text-white rounded-full shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity hover:bg-rose-600 z-10"
            title="Clear Master List"
          >
            <Trash2 size={10} />
          </button>
        )}
        {type === 'cellars' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowAddLocationModal(true);
            }}
            className="absolute -top-2 -left-2 p-1.5 bg-black text-white rounded-full shadow-lg opacity-0 group-hover/btn:opacity-100 transition-opacity hover:bg-black/70 z-10"
            title="Add location manually"
          >
            <Plus size={10} />
          </button>
        )}
      </div>
    );
  };

  const goHome = () => {
    setStep('upload');
    setOpenCompletedDropdown(null);
    setValidationError(null);
    loadSessions();
  };

  if (showAdmin && currentUser) {
    return (
      <AdminPanel
        onBack={() => setShowAdmin(false)}
        currentUserForename={currentUser.forename || currentUser.display_name}
        currentOrgName={currentUser.organisation_name}
      />
    );
  }

  if (authLoading) return null;
  if (!isAuthenticated) { loginWithRedirect(); return null; }

  if (authError) {
    return (
      <div className="min-h-screen bg-[#F5F2ED] flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white rounded-2xl border border-rose-200 shadow-lg p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-rose-600 text-xl">!</span>
          </div>
          <h2 className="text-lg font-semibold text-[#1A1A1A] mb-2">Cannot start vinoDruid</h2>
          <p className="text-sm text-rose-700 bg-rose-50 rounded-lg px-4 py-3 mb-4 text-left">{authError}</p>
          <p className="text-xs text-black/40">Update your <code className="font-mono bg-black/5 px-1 rounded">.env</code> file and restart the server.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] font-sans p-8">
      <header className="max-w-[98vw] mx-auto mb-12 flex justify-between items-end">
        <div>
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ scale: 1.02, color: "#4f46e5" }}
            whileTap={{ scale: 0.98 }}
            className="text-5xl font-serif font-light tracking-tight mb-2 cursor-pointer relative z-50"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('[Logo] Redirecting to Home');
              goHome();
            }}
          >
            Vino<span className="italic font-medium">Druid</span>
          </motion.h1>
          <div className="flex items-center gap-3">
            <p className="text-sm uppercase tracking-widest text-black/50">Wine Data Onboarding</p>
            <div className="h-1 w-1 rounded-full bg-black/20" />
            <p className="text-xs font-bold text-black/30 uppercase tracking-tighter">
              Step {step === 'upload' ? '1' : step === 'map' ? '2' : '3'} of 3
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {currentUser && (
            <div className="text-right">
              <p className="text-sm font-medium text-[#1A1A1A]">Hi {currentUser.forename || currentUser.display_name}</p>
              <p className="text-xs text-black/40 uppercase tracking-wider">{currentUser.organisation_name}</p>
            </div>
          )}
          {currentUser?.user_access === 'admin' && (
            <button
              onClick={() => setShowAdmin(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Admin
            </button>
          )}
          <button
            onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
            className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Log out
          </button>
          <button
            onClick={() => setIsRulesModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
            Validation Rules
          </button>

          {step === 'review' && (
          <div className="flex gap-4">
            {processedData.every(r => r.status === 'green') && Object.keys(manualEditsMap).length === 0 && Object.keys(autoFixedMap).length === 0 && (
              <button
                onClick={handleMarkAsComplete}
                className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider bg-emerald-600 text-white px-6 py-2 rounded-full shadow-lg hover:bg-emerald-700 transition-all flex-shrink-0"
              >
                <CheckCircle2 size={14} />
                Mark as Complete
              </button>
            )}
            <button 
              onClick={handleStartNew}
              className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider bg-white px-4 py-2 rounded-full border border-black/5 shadow-sm hover:bg-black/[0.02] transition-colors"
            >
              <RefreshCcw size={14} />
              Start New
            </button>
            {showOnlyErrors && processedData.some(r => r.status === 'red') && (
              <button
                onClick={handleExportErrors}
                className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider bg-rose-600 text-white px-6 py-2 rounded-full shadow-lg hover:scale-105 transition-all"
              >
                <Download size={14} />
                Export Errors ({processedData.filter(r => r.status === 'red').length})
              </button>
            )}
            <button
              onClick={handleExport}
              className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider bg-black text-white px-6 py-2 rounded-full shadow-lg hover:scale-105 transition-all"
            >
              <Download size={14} />
              Export Clean CSV
            </button>
          </div>
        )}
        </div>
      </header>

      <main className="max-w-[98vw] mx-auto min-h-[50vh] flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {step === 'upload' && (
            <div className="space-y-8">
              <div className="space-y-10 max-w-4xl mx-auto flex flex-col items-center">
                {/* Row 1: master listings & clients */}
                <div className="flex flex-col items-center gap-3 w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <span className="text-[10px] uppercase font-sans tracking-[0.2em] text-[#1A1A1A]/30 font-bold mb-1">
                    Master Files & Contacts
                  </span>
                  <div className="flex flex-wrap justify-center gap-4">
                    {(['private_clients', 'trade_clients', 'suppliers', 'cellars'] as DataType[]).map((type) => renderDataTypeButton(type))}
                  </div>
                </div>

                {/* Subdued separator line */}
                <div className="h-[1px] w-24 bg-[#1A1A1A]/10 my-1"></div>

                {/* Row 2: transactional & stock data */}
                <div className="flex flex-col items-center gap-3 w-full animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <span className="text-[10px] uppercase font-sans tracking-[0.2em] text-[#1A1A1A]/30 font-bold mb-1">
                    Transactions & Stock
                  </span>
                  <div className="flex flex-wrap justify-center gap-4">
                    {(['inventory', 'client_reserves', 'sales_orders', 'purchase_orders'] as DataType[]).map((type) => renderDataTypeButton(type))}
                  </div>
                </div>
              </div>
              <div className="flex justify-center gap-3 mb-8">
                {!(getActiveSessionForType(dataType) || completedTasks[dataType]) && (
                  <button
                    onClick={handleDownloadTemplate}
                    className="group flex items-center gap-3 px-5 py-3 bg-white border border-black/5 rounded-xl shadow-sm hover:border-black/20 hover:shadow-md transition-all"
                  >
                    <div className="p-2 bg-black/5 rounded-lg group-hover:bg-black/10 transition-colors">
                      <Download size={16} className="text-black/60 group-hover:text-black" />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-wider text-black/60 group-hover:text-black">
                      Download {SCHEMAS[dataType].label} Template
                    </p>
                  </button>
                )}
                {Object.keys(completedTasks).length >= 2 && (
                  <button
                    onClick={handleDownloadAllCompleted}
                    className="group flex items-center gap-3 px-5 py-3 bg-emerald-50 border border-emerald-200 rounded-xl shadow-sm hover:border-emerald-300 hover:shadow-md transition-all"
                  >
                    <div className="p-2 bg-emerald-100 rounded-lg group-hover:bg-emerald-200 transition-colors">
                      <Download size={16} className="text-emerald-700" />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                      Download All Completed ({Object.keys(completedTasks).length} files)
                    </p>
                  </button>
                )}
              </div>

              {validationError && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="max-w-2xl mx-auto p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-800"
                >
                  <AlertCircle className="w-5 h-5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{validationError}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                      <button 
                        onClick={() => setDataType('cellars')}
                        className="text-xs font-bold uppercase tracking-wider hover:underline"
                      >
                        Switch to Cellars Import
                      </button>
                      <button 
                        onClick={() => setDataType('private_clients')}
                        className="text-xs font-bold uppercase tracking-wider hover:underline text-indigo-700"
                      >
                        Switch to Private Clients
                      </button>
                      <button 
                        onClick={() => setDataType('trade_clients')}
                        className="text-xs font-bold uppercase tracking-wider hover:underline text-indigo-700"
                      >
                        Switch to Trade Clients
                      </button>
                      <button 
                        onClick={() => setDataType('suppliers')}
                        className="text-xs font-bold uppercase tracking-wider hover:underline text-indigo-700"
                      >
                        Switch to Suppliers
                      </button>
                    </div>
                  </div>
                  <button onClick={() => setValidationError(null)} className="p-1 hover:bg-rose-100 rounded-full transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              )}

              {/* Only show upload zone if NO active session and NOT marked as completed */}
              {!(getActiveSessionForType(dataType) || completedTasks[dataType]) ? (
                <FileUploader onUpload={handleUpload} />
              ) : (() => {
                const activeSession = getActiveSessionForType(dataType);
                const completedSession = getCompletedSessionForType(dataType);
                const isCompleted = !activeSession && !!completedTasks[dataType];
                return isCompleted ? (
                  <div className="max-w-2xl mx-auto p-12 bg-white rounded-3xl border border-dashed border-emerald-200 flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-6 text-emerald-600">
                      <CheckCircle2 size={32} />
                    </div>
                    <h3 className="text-xl font-serif font-medium mb-2">Session Completed</h3>
                    <p className="text-sm text-black/60 mb-2 max-w-sm">
                      {SCHEMAS[dataType].label} data has been marked as complete.
                    </p>
                    {completedTasks[dataType]?.completedAt && (
                      <p className="text-xs text-black/40 mb-8">
                        Completed {new Date(completedTasks[dataType].completedAt).toLocaleString()}
                      </p>
                    )}
                    <div className="flex gap-4">
                      {completedSession && (
                        <button
                          onClick={() => handleReopenSession(completedSession.id, dataType)}
                          className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-bold uppercase tracking-widest hover:bg-emerald-700 transition-all flex items-center gap-2"
                        >
                          <Play size={16} />
                          Reopen Session
                        </button>
                      )}
                      <button
                        onClick={() => handleExportCompleted(dataType)}
                        className="px-6 py-3 bg-white border border-black/10 text-black/70 rounded-xl font-bold uppercase tracking-widest hover:bg-black/5 transition-all flex items-center gap-2"
                      >
                        <Download size={16} />
                        Export
                      </button>
                      <button
                        onClick={() => handleStartNew(undefined, dataType)}
                        className="px-6 py-3 bg-white border border-rose-200 text-rose-600 rounded-xl font-bold uppercase tracking-widest hover:bg-rose-50 transition-all flex items-center gap-2"
                      >
                        <Plus size={16} />
                        Start New
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-2xl mx-auto p-12 bg-white rounded-3xl border border-dashed border-black/10 flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-6 text-amber-600">
                      <RefreshCcw className="animate-spin-slow" size={32} />
                    </div>
                    <h3 className="text-xl font-serif font-medium mb-2">Session in Progress</h3>
                    <p className="text-sm text-black/60 mb-8 max-w-sm">
                      You have an active session for {SCHEMAS[dataType].label}.
                    </p>
                    <div className="flex gap-4">
                      <button
                        onClick={() => { if (activeSession) handleLoadSession(activeSession.id); }}
                        className="px-6 py-3 bg-amber-500 text-white rounded-xl font-bold uppercase tracking-widest hover:bg-amber-600 transition-all flex items-center gap-2"
                      >
                        <RefreshCcw size={16} />
                        Resume Progress
                      </button>
                      <button
                        onClick={() => handleStartNew(activeSession?.id, dataType)}
                        className="px-6 py-3 bg-white border border-rose-200 text-rose-600 rounded-xl font-bold uppercase tracking-widest hover:bg-rose-50 transition-all flex items-center gap-2"
                      >
                        <Plus size={16} />
                        Start New
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {step === 'map' && (
            <SchemaMapper
              headers={headers}
              fields={getCurrentSchema().fields}
              onComplete={handleMappingComplete}
              onCancel={goHome}
              requireEitherOr={(['inventory', 'client_reserves', 'sales_orders', 'purchase_orders'] as DataType[]).includes(dataType) ? ['lwin7', 'listing_wine_name'] : undefined}
              previewRows={rawData.slice(0, 4)}
            />
          )}

          {step === 'review' && (
            <div className="space-y-6">
              <AnimatePresence>
                {pendingBulkAction && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none p-4">
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 20 }}
                      className="bg-indigo-600 text-white p-6 rounded-[2.5rem] flex flex-col md:flex-row items-center gap-6 shadow-2xl overflow-hidden max-w-2xl w-full pointer-events-auto border-4 border-white/20"
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <div className="p-4 bg-white/20 rounded-2xl shrink-0">
                          <Sparkles size={32} className="text-white" />
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.2em] opacity-80 mb-1">Smart Bulk Fix Detected</p>
                          <p className="text-lg font-medium leading-tight">
                            Found <span className="font-extrabold underline decoration-2 underline-offset-4">{pendingBulkAction.rowIds.length}</span> other rows with the same {pendingBulkAction.field.replace('_', ' ')} issue ('{pendingBulkAction.oldValue}').
                          </p>
                          <p className="text-sm mt-2 opacity-90">
                            Would you like to update them all to <span className="font-bold italic text-yellow-300">'{pendingBulkAction.newValue}'</span>?
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <button 
                          onClick={() => setPendingBulkAction(null)}
                          className="px-6 py-3 text-sm font-bold uppercase tracking-widest hover:bg-white/10 rounded-2xl transition-colors"
                        >
                          Dismiss
                        </button>
                        <button 
                          onClick={applyBulkFix}
                          className="px-8 py-3 bg-white text-indigo-600 rounded-2xl text-sm font-black uppercase tracking-widest shadow-[0_8px_20px_rgba(255,255,255,0.3)] hover:scale-105 active:scale-95 transition-all"
                        >
                          Update All
                        </button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
              <div className="flex flex-col md:flex-row gap-4 items-stretch">
                <div className="flex-1 grid grid-cols-4 gap-4">
                  <button 
                    onClick={() => { setShowOnlyErrors(false); setShowOnlyEdited(false); }}
                    className={`p-6 rounded-3xl border shadow-sm transition-all text-left ${
                      !showOnlyErrors && !showOnlyEdited 
                        ? 'bg-black border-black text-white ring-4 ring-black/10' 
                        : 'bg-white border-black/5 text-black hover:bg-black/[0.02]'
                    }`}
                  >
                    <p className={`text-[10px] uppercase tracking-widest mb-1 ${!showOnlyErrors && !showOnlyEdited ? 'text-white/60' : 'text-black/40'}`}>Total Rows</p>
                    <p className="text-3xl font-serif">{processedData.length}</p>
                  </button>
                  
                  <button 
                    onClick={() => { setShowOnlyErrors(false); setShowOnlyEdited(false); }}
                    className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 shadow-sm hover:bg-emerald-100 transition-all text-left"
                  >
                    <p className="text-[10px] uppercase tracking-widest text-emerald-600/60 mb-1">Ready</p>
                    <p className="text-3xl font-serif text-emerald-700">
                      {processedData.filter(r => r.status === 'green').length}
                    </p>
                  </button>

                  <button 
                    onClick={() => { setShowOnlyErrors(true); setShowOnlyEdited(false); }}
                    className={`p-6 rounded-3xl border shadow-sm transition-all text-left ${
                      showOnlyErrors 
                        ? 'bg-rose-500 border-rose-600 text-white ring-4 ring-rose-100' 
                        : 'bg-rose-50 border-rose-100 text-rose-700 hover:bg-rose-100'
                    }`}
                  >
                    <p className={`text-[10px] uppercase tracking-widest mb-1 ${showOnlyErrors ? 'text-white/60' : 'text-rose-600/60'}`}>Issues</p>
                    <p className="text-3xl font-serif">
                      {processedData.filter(r => r.status === 'red').length}
                    </p>
                  </button>

                  <button 
                    onClick={() => { setShowOnlyErrors(false); setShowOnlyEdited(true); }}
                    className={`p-6 rounded-3xl border shadow-sm transition-all text-left ${
                      showOnlyEdited 
                        ? 'bg-orange-500 border-orange-600 text-white ring-4 ring-orange-100' 
                        : 'bg-orange-50 border-orange-100 text-orange-700 hover:bg-orange-100'
                    }`}
                  >
                    <p className={`text-[10px] uppercase tracking-widest mb-1 ${showOnlyEdited ? 'text-white/60' : 'text-orange-600/60'}`}>Manual Fixes</p>
                    <p className="text-3xl font-serif">
                      {Object.keys(manualEditsMap).length}
                    </p>
                  </button>
                </div>
                
                <div className="bg-white p-2 rounded-3xl border border-black/5 shadow-sm flex items-center gap-1">
                  <button 
                    onClick={() => setShowOnlyErrors(false)}
                    className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                      !showOnlyErrors ? 'bg-black text-white shadow-lg' : 'text-black/40 hover:bg-black/5'
                    }`}
                  >
                    <LayoutGrid size={14} />
                    Full File
                  </button>
                  <button 
                    onClick={() => setShowOnlyErrors(true)}
                    className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest transition-all ${
                      showOnlyErrors ? 'bg-rose-500 text-white shadow-lg' : 'text-black/40 hover:bg-black/5'
                    }`}
                  >
                    <Filter size={14} />
                    Issues Only
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-none border border-[#dadce0] shadow-sm overflow-hidden flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-2 bg-[#f8f9fa] border-b border-[#dadce0]">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      {processedData.some(r => r.status === 'red') && (
                        <button
                          onClick={handleAiSmartFix}
                          disabled={isAiProcessing}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                            isAiProcessing
                              ? 'bg-amber-50 text-amber-400 border-amber-200 cursor-not-allowed'
                              : 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600 shadow-sm active:scale-95'
                          }`}
                        >
                          <Sparkles size={12} className={isAiProcessing ? 'animate-pulse' : ''} />
                          AI Smart Fix
                        </button>
                      )}

                      {(() => {
                        const hasPending = Object.keys(manualEditsMap).length > 0 || Object.keys(autoFixedMap).length > 0;
                        const noIssues = processedData.filter(r => r.status === 'red').length === 0;
                        const isReadyToCommit = hasPending && noIssues && !isAiProcessing;
                        return (
                          <button
                            onClick={handleRevalidate}
                            disabled={isAiProcessing}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                              isAiProcessing
                                ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                                : isReadyToCommit
                                  ? 'bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600 shadow-md shadow-emerald-100 animate-pulse active:scale-95'
                                  : 'bg-white text-black border-black/10 hover:bg-black/5 shadow-sm active:scale-95'
                            }`}
                          >
                            <RotateCw size={12} className={isAiProcessing ? 'animate-spin' : ''} />
                            {isReadyToCommit ? '→ Review Changes' : 'Review Change'}
                          </button>
                        );
                      })()}

                      {Object.keys(autoFixedMap).length > 0 && (
                        <button
                          onClick={handleRevertAiFixes}
                          disabled={isAiProcessing}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 transition-all active:scale-95"
                        >
                          <RefreshCcw size={12} />
                          Undo AI Changes
                        </button>
                      )}
                      
                      {history.length > 0 && (
                        <button
                          onClick={handleUndo}
                          disabled={isAiProcessing}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50 transition-all active:scale-95"
                          title="Undo last manual edit (Ctrl+Z)"
                        >
                          <RotateCcw size={12} />
                          Undo Edit
                        </button>
                      )}
                      {processedData.some(r => r.isDuplicate) && (
                        <button
                          onClick={startDuplicateReview}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-all active:scale-95"
                        >
                          <Copy size={12} />
                          Review Duplicates ({processedData.filter(r => r.isDuplicate).length})
                        </button>
                      )}
                      {processedData.some(r => r.isPriceOutlier) && (
                        <button
                          onClick={startPriceReview}
                          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-all active:scale-95"
                        >
                          <Calculator size={12} />
                          Review Prices ({processedData.filter(r => r.isPriceOutlier).length})
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-rose-500"></div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">Errors</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-sky-400"></div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">AI Calculated</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">AI Fixed / Warning</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-black/40">Valid</span>
                    </div>
                  </div>
                  <div className="text-[10px] font-medium text-black/40 italic">
                    * Click any cell to edit. AI fixed cells are highlighted in yellow.
                  </div>
                </div>

                <div className="overflow-auto flex-1 h-[75vh]">
                  <table className="w-full text-left border-collapse min-w-max">
                    <thead className="sticky top-0 bg-[#f8f9fa] z-10">
                      <tr className="text-[11px] font-medium text-[#5f6368] border-b border-[#dadce0]">
                        <th className="w-12 px-2 py-1.5 text-center border-r border-[#dadce0] bg-[#f8f9fa] sticky left-0 z-20"></th>
                        {SCHEMAS[dataType].fields.map(field => (
                          <th key={field.key} className="px-3 py-1.5 border-r border-[#dadce0] font-normal min-w-[150px]">
                            {field.label}
                          </th>
                        ))}
                        <th className="px-3 py-1.5 w-32 font-normal border-l border-[#dadce0] sticky right-0 bg-[#f8f9fa] z-20 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {processedData
                        .filter(row => {
                          if (showOnlyErrors) return row.status === 'red';
                          if (showOnlyEdited) return manualEditsMap[row.id] !== undefined;
                          return true;
                        })
                        .map((row, idx) => (
                        <tr key={row.id} className="border-b border-[#dadce0] hover:bg-[#f1f3f4] transition-colors group h-9">
                          <td className="px-2 py-1 text-center border-r border-[#dadce0] bg-[#f8f9fa] text-[10px] text-[#70757a] select-none sticky left-0 z-10">
                            {row.id + 1}
                          </td>
                          {SCHEMAS[dataType].fields.map(field => {
                            const val = row[field.key];
                            const isEditing = editingCell?.rowId === row.id && editingCell?.fieldKey === field.key;
                            const hasFieldError = row.fieldErrors?.includes(field.key);
                            const isAutoFixed = row.autoFixedFields?.includes(field.key);
                            const isManuallyEdited = row.manualEdits?.includes(field.key);
                            const calcLog = row.calculationLogs?.[field.key];

                            // Determine background class
                            let bgClass = '';
                            if (isEditing) {
                              bgClass = 'bg-white p-0 ring-2 ring-indigo-500 z-20 shadow-lg';
                            } else if (hasFieldError) {
                              bgClass = 'bg-rose-50';
                            } else if (isManuallyEdited) {
                              bgClass = 'bg-orange-50';
                            } else if (isAutoFixed) {
                              bgClass = calcLog ? 'bg-sky-50' : 'bg-amber-50';
                            }

                            return (
                              <td 
                                key={field.key} 
                                className={`px-3 py-0 text-sm border-r border-[#dadce0] last:border-r-0 cursor-cell relative min-w-[150px] transition-all ${bgClass}`}
                                onClick={() => startEditingCell(row.id, field.key)}
                                title={calcLog || ''}
                              >
                                {isEditing ? (
                                  field.options ? (
                                    <select
                                      autoFocus
                                      className="w-full h-full px-3 py-1 bg-inherit outline-none text-sm appearance-none"
                                      value={val === null || val === undefined ? '' : String(val)}
                                      onChange={(e) => {
                                        const newData = [...processedData];
                                        const rowIndex = newData.findIndex(r => r.id === row.id);
                                        newData[rowIndex] = { ...newData[rowIndex], [field.key]: e.target.value };
                                        setProcessedData(newData);
                                      }}
                                      onBlur={(e) => {
                                        setEditingCell(null);
                                        const updatedRow = { ...row, [field.key]: e.target.value };
                                        handleRowUpdate(updatedRow, field.key);
                                      }}
                                    >
                                      <option value="">Select {field.label}...</option>
                                      {field.options.map(opt => (
                                        <option key={opt} value={opt}>{opt}</option>
                                      ))}
                                    </select>
                                  ) : field.key === 'cellar_name' ? (
                                    <CellarAutocomplete
                                      value={val === null || val === undefined ? '' : String(val)}
                                      suggestions={masterCellars}
                                      onChange={(newVal) => {
                                        const newData = [...processedData];
                                        const rowIndex = newData.findIndex(r => r.id === row.id);
                                        newData[rowIndex] = { ...newData[rowIndex], [field.key]: newVal };
                                        setProcessedData(newData);
                                      }}
                                      onBlur={(finalVal) => {
                                        setEditingCell(null);
                                        const updatedRow = { ...row, [field.key]: finalVal };
                                        handleRowUpdate(updatedRow, field.key);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          setEditingCell(null);
                                          const updatedRow = { ...row, [field.key]: (e.target as HTMLInputElement).value };
                                          handleRowUpdate(updatedRow, field.key);
                                        }
                                      }}
                                    />
                                  ) : (
                                    <input
                                      autoFocus
                                      type="text"
                                      className="w-full h-full px-3 py-1 bg-inherit outline-none text-sm"
                                      value={val === null || val === undefined ? '' : String(val)}
                                      onChange={(e) => {
                                        const newData = [...processedData];
                                        const rowIndex = newData.findIndex(r => r.id === row.id);
                                        newData[rowIndex] = { ...newData[rowIndex], [field.key]: e.target.value };
                                        setProcessedData(newData);
                                      }}
                                      onBlur={(e) => {
                                        setEditingCell(null);
                                        const updatedRow = { ...row, [field.key]: e.target.value };
                                        handleRowUpdate(updatedRow, field.key);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          setEditingCell(null);
                                          const updatedRow = { ...row, [(e.target as HTMLInputElement).name || field.key]: (e.target as HTMLInputElement).value };
                                          handleRowUpdate(updatedRow, field.key);
                                        }
                                      }}
                                    />
                                  )
                                ) : (
                                  <div className="flex items-center gap-2 h-full overflow-hidden">
                                    {isAutoFixed && (
                                      calcLog ? (
                                        <Calculator size={10} className="text-sky-500 shrink-0" />
                                      ) : (
                                        <Sparkles size={10} className="text-amber-500 shrink-0" />
                                      )
                                    )}
                                    {isManuallyEdited && (
                                      <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                                    )}
                                    <span className={`truncate whitespace-nowrap ${isAutoFixed ? (calcLog ? 'text-sky-900 font-medium' : 'text-amber-900 font-medium') : 'text-[#202124]'} ${isManuallyEdited ? 'text-orange-900 font-medium' : ''} ${hasFieldError ? 'text-rose-600 font-bold' : ''}`}>
                                      {field.key === 'vintage' ? (
                                        <span className={`px-1 rounded text-[11px] font-mono ${
                                          hasFieldError ? 'bg-rose-100' : ''
                                        }`}>
                                          {val}
                                        </span>
                                      ) : (
                                        String(val || '')
                                      )}
                                    </span>
                                    {field.key === 'lwin' && row.isDuplicate && (
                                      <Copy size={10} className="text-amber-500 shrink-0" />
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                           <td className="px-3 py-1 border-l border-[#dadce0] sticky right-0 bg-white group-hover:bg-[#f1f3f4] z-10">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteRow(row.id); }}
                                title="Remove this row"
                                className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 p-0.5 rounded hover:bg-rose-100 text-black/20 hover:text-rose-500"
                              >
                                <X size={11} />
                              </button>
                              {row.status === 'red' ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const firstErrorField = row.fieldErrors?.[0] || (getCurrentSchema().fields[0]?.key || 'listing_wine_name');
                                    startEditingCell(row.id, firstErrorField);
                                  }}
                                  title={row.errors.join('\n')}
                                  className="bg-rose-600 text-white px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-rose-700 transition-colors flex items-center gap-1"
                                >
                                  <AlertCircle size={10} />
                                  Fix Issue
                                </button>
                              ) : row.isDuplicate ? (
                                <div className="flex flex-col gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setComparingDuplicate({ row1: row.duplicateOf!, row2: row.id });
                                    }}
                                    title="Compare these rows side-by-side"
                                    className="bg-sky-100 text-sky-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-sky-200 transition-colors flex items-center gap-1 border border-sky-200 w-full justify-center"
                                  >
                                    <HelpCircle size={10} />
                                    Compare
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteRow(row.id);
                                    }}
                                    title={`Suspect duplicate of row ${(row.duplicateOf ?? 0) + 1}. Click to remove.`}
                                    className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-amber-200 transition-colors flex items-center gap-1 border border-amber-200 w-full justify-center"
                                  >
                                    <Trash2 size={10} />
                                    Remove
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleIgnoreDuplicate(row.id);
                                    }}
                                    title="Mark as not a duplicate"
                                    className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-gray-200 transition-colors flex items-center gap-1 border border-gray-200 w-full justify-center"
                                  >
                                    <Check size={10} />
                                    Keep
                                  </button>
                                </div>
                              ) : row.isPriceOutlier ? (
                                <div className="flex flex-col gap-1">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startEditingCell(row.id, dataType === 'client_reserves' ? 'case_cost_price' : 'exc_vat_case');
                                    }}
                                    title="Modify price"
                                    className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-indigo-200 transition-colors flex items-center gap-1 border border-indigo-200 w-full justify-center"
                                  >
                                    <Edit2 size={10} />
                                    Modify
                                  </button>
                                  {row.priceOutlierRefRowId !== undefined && (
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setComparingDuplicate({ row1: row.priceOutlierRefRowId!, row2: row.id });
                                      }}
                                      title="Compare with reference row"
                                      className="bg-sky-100 text-sky-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-sky-200 transition-colors flex items-center gap-1 border border-sky-200 w-full justify-center"
                                    >
                                      <HelpCircle size={10} />
                                      Compare
                                    </button>
                                  )}
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleIgnorePriceWarning(row.id);
                                    }}
                                    title="Keep this price"
                                    className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider hover:bg-gray-200 transition-colors flex items-center gap-1 border border-gray-200 w-full justify-center"
                                  >
                                    <Check size={10} />
                                    Keep
                                  </button>
                                </div>
                              ) : (
                                <div 
                                  className="flex items-center justify-center w-full h-full cursor-help"
                                  title={row.errors.length > 0 ? row.errors.join('\n') : 'Row is valid'}
                                >
                                  <div className={`w-2.5 h-2.5 rounded-full ${
                                    row.status === 'green' ? 'bg-emerald-500' : 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                                  }`} />
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {comparingDuplicate !== null && (
          <DuplicateComparisonModal
            row1={processedData.find(r => r.id === comparingDuplicate.row1)}
            row2={processedData.find(r => r.id === comparingDuplicate.row2)}
            type={processedData.find(r => r.id === comparingDuplicate.row2)?.isPriceOutlier ? 'price' : 'duplicate'}
            fields={SCHEMAS[dataType].fields}
            queueInfo={reviewQueueType ? {
              remaining: reviewQueueType === 'duplicate'
                ? processedData.filter(r => r.isDuplicate).length
                : processedData.filter(r => r.isPriceOutlier).length
            } : undefined}
            onKeep={(id) => {
              const row = processedData.find(r => r.id === id);
              if (row?.isPriceOutlier) {
                handleIgnorePriceWarning(id);
              } else {
                handleIgnoreDuplicate(id);
              }
              if (reviewQueueType) {
                setPendingQueueAdvance(true);
              } else {
                setComparingDuplicate(null);
              }
            }}
            onRemove={(id) => {
              handleDeleteRow(id);
              if (reviewQueueType) {
                setPendingQueueAdvance(true);
              } else {
                setComparingDuplicate(null);
              }
            }}
            onEdit={(rowId, fieldKey, newValue) => {
              const row = processedData.find(r => r.id === rowId);
              if (!row) return;
              handleRowUpdate({ ...row, [fieldKey]: newValue }, fieldKey);
            }}
            onClose={() => {
              setReviewQueueType(null);
              setComparingDuplicate(null);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingRowId !== null && (
          <RowEditor 
            row={processedData.find(r => r.id === editingRowId)}
            originalRow={processedData.find(r => r.id === editingRowId)?.duplicateOf !== undefined 
              ? processedData.find(r => r.id === processedData.find(r => r.id === editingRowId)?.duplicateOf) 
              : undefined}
            fields={getCurrentSchema().fields}
            onSave={handleRowUpdate}
            onDelete={handleDeleteRow}
            onClose={() => setEditingRowId(null)}
          />
        )}
      </AnimatePresence>
      {showAddLocationModal && (
        <AddLocationModal
          onSave={handleAddLocation}
          onClose={() => setShowAddLocationModal(false)}
        />
      )}
      </main>

      <RulesModal 
        isOpen={isRulesModalOpen} 
        onClose={() => setIsRulesModalOpen(false)} 
        dataType={dataType}
      />


      <AiFixReviewModal
        isOpen={isAiReviewModalOpen}
        onClose={() => setIsAiReviewModalOpen(false)}
        changes={aiChangesSummary}
        onConfirm={confirmAiFixes}
        onRevert={() => {
          setIsAiReviewModalOpen(false);
          setAiChangesSummary([]);
          setPendingAiChanges([]);
        }}
      />

      <footer className="max-w-[98vw] mx-auto mt-20 pt-8 border-t border-black/10 flex justify-between items-center text-[10px] uppercase tracking-[0.2em] text-black/30">
        <div>© 2026 vinoDruid</div>
      </footer>
    </div>
  );
}

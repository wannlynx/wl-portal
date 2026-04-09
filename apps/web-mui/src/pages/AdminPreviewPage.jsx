import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControlLabel,
  Grid,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Checkbox,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import { api } from "../api";
import packageMeta from "../../package.json";
import { normalizeTankLimits, TANK_LIMIT_FAMILIES } from "../tankLimits";

const EMPTY_BRANDING = { name: "", logoUrl: "" };
const EMPTY_OPIS = { username: "", password: "" };
const EMPTY_EIA = { apiKey: "" };
const EMPTY_USER = { name: "", email: "", password: "", role: "manager", jobberId: "", siteIds: [] };
const CUSTOMER_STATUS_OPTIONS = [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }];
const PRICING_BRANCH_OPTIONS = [{ value: "unbranded", label: "Unbranded" }, { value: "branded", label: "Branded" }, { value: "spot", label: "Spot" }, { value: "rack", label: "Rack" }];
const MARKET_KEY_OPTIONS = [{ value: "san_francisco", label: "San Francisco" }, { value: "benicia", label: "Benicia (San Francisco rack)" }, { value: "sacramento", label: "Sacramento" }, { value: "san_jose", label: "San Jose" }, { value: "stockton", label: "Stockton" }, { value: "bay_area", label: "Bay Area" }];
const TERMINAL_KEY_OPTIONS = [{ value: "benicia_terminal", label: "Benicia / San Francisco" }, { value: "stockton_terminal", label: "Stockton" }, { value: "sacramento_terminal", label: "Sacramento" }, { value: "san_jose_terminal", label: "San Jose" }, { value: "san_francisco_terminal", label: "San Francisco" }];
const PRODUCT_FAMILY_OPTIONS = [{ value: "regular", label: "Regular" }, { value: "mid", label: "Mid" }, { value: "premium", label: "Premium" }, { value: "diesel", label: "Diesel" }];
const RULE_STATUS_OPTIONS = [{ value: "draft", label: "Draft" }, { value: "active", label: "Active" }, { value: "retired", label: "Retired" }];
const VENDOR_SELECTION_MODE_OPTIONS = [{ value: "lowest", label: "Lowest" }, { value: "highest", label: "Highest" }, { value: "first_available", label: "First Available" }, { value: "specific_vendor", label: "Specific Vendor" }];
const VENDOR_BASIS_MODE_OPTIONS = [{ value: "match_rule_vendor", label: "Use Selected Rack Value" }, { value: "rack_average", label: "Use Rack Comparison Average" }];
const VENDOR_KEY_OPTIONS = [{ value: "valero", label: "Valero" }, { value: "psx", label: "Phillips 66" }, { value: "tesoro", label: "Tesoro" }, { value: "marathon", label: "Marathon" }, { value: "shell", label: "Shell" }, { value: "chevron", label: "Chevron" }, { value: "bp", label: "BP" }];
const PROFILE_RULE_FIELDS = ["distributionLabel", "gasPrepay", "dieselPrepay", "storageFee", "gasFedExcise", "gasStateExcise", "dieselFedExcise", "dieselStateExcise", "gasSalesTaxRate", "dieselSalesTaxRate", "gasRetailMargin", "dieselRetailMargin"];
const EMPTY_CUSTOMER = { name: "", addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "", terminalKey: "", status: "active" };
const EMPTY_PROFILE = { effectiveStart: "", effectiveEnd: "", freightMiles: "", freightCostGas: "", freightCostDiesel: "", rackMarginGas: "", rackMarginDiesel: "", discountRegular: "", discountMid: "", discountPremium: "", discountDiesel: "", branch: "unbranded", marketKey: "", terminalKey: "", distributionLabel: "", gasPrepay: "", dieselPrepay: "", storageFee: "", gasFedExcise: "", gasStateExcise: "", dieselFedExcise: "", dieselStateExcise: "", gasSalesTaxRate: "", dieselSalesTaxRate: "", gasRetailMargin: "", dieselRetailMargin: "", extraRulesJson: "{}" };
const EMPTY_RULE = { name: "", productFamily: "regular", effectiveStart: "", effectiveEnd: "", status: "draft", versionLabel: "", notes: "" };
const EMPTY_VENDOR_SET = { selectionMode: "lowest", productFamily: "regular", marketKey: "", basisMode: "match_rule_vendor", vendorsCsv: "" };
const TABS = ["overview", "users", "branding", "credentials", "profiles", "rules", "tank-limits", "pricing", "version"];
  const VENDOR_SET_HELP_LINES = [
    { label: "selectionMode", description: "lowest: use the lowest available rack vendor from the selected vendor list; highest: use the highest available vendor; first_available: use the first vendor row found; specific_vendor: effectively constrain to the listed vendor(s), usually one." },
    { label: "basisMode", description: "Use Selected Rack Value: the Rack Basis card shows the exact rack value the rule selected, so it matches Lowest Rack Input. Use Rack Comparison Average: the Rack Basis card shows the broader comparison rack value for the market instead, which may differ from Lowest Rack Input." },
    { label: "marketKey", description: "Empty means the rule applies to all markets. Otherwise it only applies to that market, like sacramento or stockton." },
    { label: "productFamily", description: "Which fuel family the vendor set applies to: regular, mid, premium, diesel." }
  ];

function statusTone(saved) {
  return saved ? "success" : "default";
}

function formatDateTime(value) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString();
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function adminTabLabel(value) {
  if (value === "profiles") return "terminals";
  if (value === "tank-limits") return "tank limits";
  if (value === "version") return "version";
  return value;
}

function customerToForm(customer) {
  return { ...EMPTY_CUSTOMER, ...(customer || {}) };
}

function profileToForm(profile) {
  if (!profile) return EMPTY_PROFILE;
  const rules = profile.rules || {};
  const {
    branch = "unbranded",
    marketKey = "",
    terminalKey = "",
    distributionLabel = "",
    gasPrepay = "",
    dieselPrepay = "",
    storageFee = "",
    gasFedExcise = "",
    gasStateExcise = "",
    dieselFedExcise = "",
    dieselStateExcise = "",
    gasSalesTaxRate = "",
    dieselSalesTaxRate = "",
    gasRetailMargin = "",
    dieselRetailMargin = "",
    ...extraRules
  } = rules;
  return {
    ...EMPTY_PROFILE,
    ...profile,
    branch,
    marketKey,
    terminalKey,
    distributionLabel,
    gasPrepay,
    dieselPrepay,
    storageFee,
    gasFedExcise,
    gasStateExcise,
    dieselFedExcise,
    dieselStateExcise,
    gasSalesTaxRate,
    dieselSalesTaxRate,
    gasRetailMargin,
    dieselRetailMargin,
    extraRulesJson: prettyJson(extraRules)
  };
}

function ruleToForm(rule) {
  return rule ? { ...EMPTY_RULE, ...rule } : { ...EMPTY_RULE };
}

function vendorSetsToRows(vendorSets, family) {
  return vendorSets?.length
    ? vendorSets.map((item) => ({
        selectionMode: item.selectionMode || "lowest",
        productFamily: item.productFamily || family,
        marketKey: item.marketKey || "",
        basisMode: item.basisMode || "match_rule_vendor",
        vendorsCsv: Array.isArray(item.vendors) ? item.vendors.join(", ") : ""
      }))
    : [{ ...EMPTY_VENDOR_SET, productFamily: family || "regular" }];
}

function SummaryCard({ label, value, caption }) {
  return (
    <Card variant="outlined" sx={{ height: "100%" }}>
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">{label}</Typography>
          <Typography variant="h5">{value}</Typography>
          {caption ? <Typography variant="caption" color="text.secondary">{caption}</Typography> : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function Section({ title, subtitle, children, action }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
            <Box>
              <Typography variant="h6">{title}</Typography>
              {subtitle ? <Typography variant="body2" color="text.secondary">{subtitle}</Typography> : null}
            </Box>
            {action}
          </Stack>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}

export function AdminPreviewPage({ user, jobber, onJobberUpdated }) {
  const [tab, setTab] = useState("overview");
  const [taskFocus, setTaskFocus] = useState("");
  const [brandingForm, setBrandingForm] = useState(EMPTY_BRANDING);
  const [opisForm, setOpisForm] = useState(EMPTY_OPIS);
  const [eiaForm, setEiaForm] = useState(EMPTY_EIA);
  const [opisStatus, setOpisStatus] = useState(null);
  const [eiaStatus, setEiaStatus] = useState(null);
  const [pricingConfigs, setPricingConfigs] = useState([]);
  const [pricingRules, setPricingRules] = useState([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [ruleForm, setRuleForm] = useState(EMPTY_RULE);
  const [vendorSetRows, setVendorSetRows] = useState([{ ...EMPTY_VENDOR_SET }]);
  const [showVendorSetHelp, setShowVendorSetHelp] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerForm, setCustomerForm] = useState(EMPTY_CUSTOMER);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE);
  const [isNewCustomerDraft, setIsNewCustomerDraft] = useState(false);
  const [managementOverview, setManagementOverview] = useState(null);
  const [userForm, setUserForm] = useState(EMPTY_USER);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingBranding, setSavingBranding] = useState(false);
  const [savingOpis, setSavingOpis] = useState(false);
  const [savingEia, setSavingEia] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [savingTankLimits, setSavingTankLimits] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [apiHealth, setApiHealth] = useState(null);
  const [tankLimitsForm, setTankLimitsForm] = useState(() => normalizeTankLimits(jobber?.tankLimits));
  const isPhone = typeof window !== "undefined" ? window.matchMedia("(max-width: 899.95px)").matches : false;
  const appVersion = packageMeta.version || "0.0.0";
  const appReleaseDate = packageMeta.releaseDate || "Not recorded";
  const appReleaseDateTime = packageMeta.releaseDateTime || appReleaseDate;
  const apiVersion = apiHealth?.apiVersion || "Unavailable";
  const apiReleaseDate = apiHealth?.apiReleaseDate || "Not recorded";
  const apiReleaseDateTime = apiHealth?.apiReleaseDateTime || apiReleaseDate;

  const canManage = user?.jobberRole === "admin" || user?.role === "system_manager";

  useEffect(() => {
    setBrandingForm({
      name: jobber?.name || "",
      logoUrl: jobber?.logoUrl || ""
    });
    setTankLimitsForm(normalizeTankLimits(jobber?.tankLimits));
  }, [jobber]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      try {
        const [opisResult, eiaResult, pricingResult, customersResult] = await Promise.allSettled([
          api.getJobberOpisCredentialsStatus(),
          api.getJobberEiaCredentialsStatus(),
          api.getJobberPricingConfigs(),
          api.getCustomers()
        ]);
        if (ignore) return;

        if (opisResult.status === "fulfilled") {
          setOpisStatus(opisResult.value);
        } else {
          setOpisStatus(null);
        }

        if (eiaResult.status === "fulfilled") {
          setEiaStatus(eiaResult.value);
        } else {
          setEiaStatus(null);
        }

        if (pricingResult.status === "fulfilled") {
          setPricingConfigs(Array.isArray(pricingResult.value) ? pricingResult.value : []);
        } else {
          setPricingConfigs([]);
        }

        try {
          const nextRules = await api.getPricingRules();
          if (!ignore) {
            const normalizedRules = Array.isArray(nextRules) ? nextRules : [];
            setPricingRules(normalizedRules);
            setSelectedRuleId((current) => current || normalizedRules[0]?.id || "");
          }
        } catch (_nextRulesError) {
          if (!ignore) {
            setPricingRules([]);
          }
        }

        if (customersResult.status === "fulfilled") {
          const nextCustomers = Array.isArray(customersResult.value) ? customersResult.value : [];
          setCustomers(nextCustomers);
          setSelectedCustomerId((current) => current || nextCustomers[0]?.id || "");
        } else {
          setCustomers([]);
        }

        try {
          const nextManagementOverview = await api.getManagementOverview();
          if (!ignore) setManagementOverview(nextManagementOverview);
        } catch (_nextManagementError) {
          if (!ignore) setManagementOverview(null);
        }
        try {
          const nextApiHealth = await api.getApiHealth();
          if (!ignore) setApiHealth(nextApiHealth);
        } catch (_nextHealthError) {
          if (!ignore) setApiHealth(null);
        }
        const loadIssues = [];
        if (opisResult.status === "rejected") loadIssues.push("OPIS status");
        if (eiaResult.status === "rejected") loadIssues.push("EIA status");
        if (pricingResult.status === "rejected") loadIssues.push("pricing configs");
        if (customersResult.status === "rejected") loadIssues.push("terminal profiles");
        setError(loadIssues.length ? `Some admin data did not load: ${loadIssues.join(", ")}.` : "");
      } catch (nextError) {
        if (!ignore) {
          setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load admin workspace"));
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [jobber?.id]);

  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerForm(EMPTY_CUSTOMER);
      setProfileForm(EMPTY_PROFILE);
      return;
    }
    setIsNewCustomerDraft(false);
    let ignore = false;
    Promise.all([
      api.getCustomer(selectedCustomerId),
      api.getCustomerPricingProfile(selectedCustomerId)
    ]).then(([customer, profile]) => {
      if (ignore) return;
      setCustomerForm(customerToForm(customer));
      setProfileForm(profileToForm(profile));
    }).catch((nextError) => {
      if (ignore) return;
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load terminal profile"));
    });
    return () => {
      ignore = true;
    };
  }, [selectedCustomerId]);

  useEffect(() => {
    if (!selectedRuleId) {
      setRuleForm({ ...EMPTY_RULE });
      setVendorSetRows([{ ...EMPTY_VENDOR_SET }]);
      return;
    }
    let ignore = false;
    api.getPricingRule(selectedRuleId).then((rule) => {
      if (ignore) return;
      setRuleForm(ruleToForm(rule));
      setVendorSetRows(vendorSetsToRows(rule.vendorSets || [], rule.productFamily || "regular"));
    }).catch((nextError) => {
      if (ignore) return;
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to load pricing rule"));
    });
    return () => {
      ignore = true;
    };
  }, [selectedRuleId]);

  const pricingSummary = useMemo(() => {
    const configs = pricingConfigs || [];
    const withCustomMargin = configs.filter((row) => Number(row.marginCents || row.margin || 0) !== 0).length;
    return {
      total: configs.length,
      withCustomMargin,
      markets: new Set(configs.map((row) => row.marketLabel || row.location || row.marketKey).filter(Boolean)).size
    };
  }, [pricingConfigs]);

  const managementUsers = useMemo(() => managementOverview?.users || [], [managementOverview]);
  const managementSites = useMemo(() => managementOverview?.sites || [], [managementOverview]);
  const isSystemScope = managementOverview?.scope === "system";
  const activeJobberId = managementOverview?.jobber?.id || jobber?.id || "";
  const filteredUsers = useMemo(() => {
    if (!managementUsers.length) return [];
    if (isSystemScope) return managementUsers;
    return managementUsers.filter((row) => row.jobberId === activeJobberId);
  }, [activeJobberId, isSystemScope, managementUsers]);
  const filteredSites = useMemo(() => {
    if (!managementSites.length) return [];
    if (isSystemScope) return managementSites;
    return managementSites.filter((row) => row.jobberId === activeJobberId);
  }, [activeJobberId, isSystemScope, managementSites]);
  const selectedUser = useMemo(() => filteredUsers.find((row) => row.id === selectedUserId) || null, [filteredUsers, selectedUserId]);
  const roleCounts = useMemo(() => {
    return filteredUsers.reduce((acc, row) => {
      if (row.role === "admin") acc.admin += 1;
      if (row.role === "manager") acc.manager += 1;
      return acc;
    }, { admin: 0, manager: 0 });
  }, [filteredUsers]);
  const availableSitesForUserForm = useMemo(() => {
    const targetJobberId = userForm.jobberId || activeJobberId;
    return filteredSites.filter((row) => !targetJobberId || row.jobberId === targetJobberId);
  }, [activeJobberId, filteredSites, userForm.jobberId]);
  const selectedCustomer = useMemo(() => customers.find((row) => row.id === selectedCustomerId) || null, [customers, selectedCustomerId]);

  useEffect(() => {
    if (!selectedUser) return;
    setUserForm({
      name: selectedUser.name || "",
      email: selectedUser.email || "",
      password: "",
      role: selectedUser.role || "manager",
      jobberId: selectedUser.jobberId || activeJobberId,
      siteIds: selectedUser.siteIds || []
    });
  }, [activeJobberId, selectedUser]);

  useEffect(() => {
    if (!selectedUser && activeJobberId) {
      setUserForm((current) => ({ ...EMPTY_USER, jobberId: current.jobberId || activeJobberId }));
    }
  }, [activeJobberId, selectedUser]);

  function clearUserWorkspace() {
    setSelectedUserId("");
    setUserForm({ ...EMPTY_USER, jobberId: activeJobberId });
  }

  function toggleUserSite(siteId) {
    setUserForm((current) => ({
      ...current,
      siteIds: current.siteIds.includes(siteId)
        ? current.siteIds.filter((id) => id !== siteId)
        : [...current.siteIds, siteId]
    }));
  }

  async function reloadManagementOverview() {
    const nextOverview = await api.getManagementOverview();
    setManagementOverview(nextOverview);
    return nextOverview;
  }

  async function reloadCustomers(preferredCustomerId = "") {
    const nextCustomers = await api.getCustomers();
    setCustomers(Array.isArray(nextCustomers) ? nextCustomers : []);
    if (preferredCustomerId) {
      setSelectedCustomerId(preferredCustomerId);
      setIsNewCustomerDraft(false);
    } else if (!selectedCustomerId && nextCustomers?.[0]?.id) {
      setSelectedCustomerId(nextCustomers[0].id);
      setIsNewCustomerDraft(false);
    }
    return nextCustomers;
  }

  async function reloadRules(preferredRuleId = "") {
    const nextRules = await api.getPricingRules();
    const normalizedRules = Array.isArray(nextRules) ? nextRules : [];
    setPricingRules(normalizedRules);
    if (preferredRuleId) {
      setSelectedRuleId(preferredRuleId);
    } else if (!selectedRuleId && normalizedRules?.[0]?.id) {
      setSelectedRuleId(normalizedRules[0].id);
    }
    return normalizedRules;
  }

  function createRuleDraft() {
    setSelectedRuleId("");
    setRuleForm({ ...EMPTY_RULE });
    setVendorSetRows([{ ...EMPTY_VENDOR_SET, productFamily: "regular" }]);
  }

  function updateVendorSetRow(index, field, value) {
    setVendorSetRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  }

  function addVendorSetRow() {
    setVendorSetRows((current) => [...current, { ...EMPTY_VENDOR_SET, productFamily: ruleForm.productFamily || "regular" }]);
  }

  function removeVendorSetRow(index) {
    setVendorSetRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  function toggleVendorInRow(index, vendorKey) {
    setVendorSetRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const currentVendors = row.vendorsCsv.split(",").map((item) => item.trim()).filter(Boolean);
        const nextVendors = currentVendors.includes(vendorKey)
          ? currentVendors.filter((item) => item !== vendorKey)
          : [...currentVendors, vendorKey];
        return {
          ...row,
          vendorsCsv: nextVendors.join(", ")
        };
      })
    );
  }

  function updateTankLimit(familyKey, field, value) {
    setTankLimitsForm((current) => ({
      ...current,
      [familyKey]: {
        ...current[familyKey],
        [field]: value
      }
    }));
  }

  async function saveTankLimitsWorkspace() {
    setSavingTankLimits(true);
    setError("");
    setMessage("");
    try {
      const normalized = normalizeTankLimits(tankLimitsForm);
      const updated = await api.updateCurrentJobber({ tankLimits: normalized });
      setTankLimitsForm(normalizeTankLimits(updated?.tankLimits));
      onJobberUpdated?.(updated);
      setMessage("Tank limits saved for this jobber.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to save tank limits"));
    } finally {
      setSavingTankLimits(false);
    }
  }

  function onLogoFileSelected(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setBrandingForm((current) => ({ ...current, logoUrl: reader.result }));
      }
    };
    reader.readAsDataURL(file);
  }

  async function saveBranding(event) {
    event.preventDefault();
    setSavingBranding(true);
    setError("");
    setMessage("");
    try {
      const updated = await api.updateCurrentJobber({
        name: brandingForm.name.trim() || jobber?.name || "Jobber",
        logoUrl: brandingForm.logoUrl
      });
      onJobberUpdated?.(updated);
      setMessage("Jobber branding updated.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to save branding"));
    } finally {
      setSavingBranding(false);
    }
  }

  async function saveOpis(event) {
    event.preventDefault();
    setSavingOpis(true);
    setError("");
    setMessage("");
    try {
      const nextStatus = await api.saveJobberOpisCredentials({
        username: opisForm.username.trim(),
        password: opisForm.password
      });
      setOpisStatus(nextStatus);
      setOpisForm(EMPTY_OPIS);
      setMessage("OPIS credentials saved securely for this jobber.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to save OPIS credentials"));
    } finally {
      setSavingOpis(false);
    }
  }

  async function saveEia(event) {
    event.preventDefault();
    setSavingEia(true);
    setError("");
    setMessage("");
    try {
      const nextStatus = await api.saveJobberEiaCredentials({
        apiKey: eiaForm.apiKey.trim()
      });
      setEiaStatus(nextStatus);
      setEiaForm(EMPTY_EIA);
      setMessage("EIA API key saved securely for this jobber.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to save EIA key"));
    } finally {
      setSavingEia(false);
    }
  }

  async function saveCustomerProfileCustomer() {
    setSavingCustomer(true);
    setError("");
    setMessage("");
    try {
      if (isNewCustomerDraft) {
        const created = await api.createCustomer(customerForm);
        await reloadCustomers(created?.id);
        setProfileForm(EMPTY_PROFILE);
        setMessage("Terminal created.");
      } else {
        if (!selectedCustomerId) return;
        await api.updateCustomer(selectedCustomerId, customerForm);
        await reloadCustomers(selectedCustomerId);
        setMessage("Terminal profile updated.");
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to save terminal profile"));
    } finally {
      setSavingCustomer(false);
    }
  }

  async function createCustomerProfileCustomer() {
    setError("");
    setMessage("");
    setSelectedCustomerId("");
    setCustomerForm(EMPTY_CUSTOMER);
    setProfileForm(EMPTY_PROFILE);
    setIsNewCustomerDraft(true);
  }

  async function deleteCustomerProfileCustomer() {
    if (!selectedCustomerId || isNewCustomerDraft || !selectedCustomer) return;
    if (!window.confirm(`Delete terminal ${selectedCustomer.name}?`)) return;
    setSavingCustomer(true);
    setError("");
    setMessage("");
    try {
      await api.deleteCustomer(selectedCustomerId);
      const nextCustomers = await api.getCustomers();
      setCustomers(Array.isArray(nextCustomers) ? nextCustomers : []);
      setSelectedCustomerId(nextCustomers?.[0]?.id || "");
      setIsNewCustomerDraft(false);
      setMessage("Terminal deleted.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to delete terminal"));
    } finally {
      setSavingCustomer(false);
    }
  }

  async function saveCustomerProfile() {
    if (!selectedCustomerId) return;
    setSavingProfile(true);
    setError("");
    setMessage("");
    try {
      const extraRules = profileForm.extraRulesJson ? JSON.parse(profileForm.extraRulesJson) : {};
      const normalizedRuleFields = Object.fromEntries(
        PROFILE_RULE_FIELDS.map((field) => [field, profileForm[field] === "" ? null : profileForm[field]])
      );
      await api.saveCustomerPricingProfile(selectedCustomerId, {
        ...profileForm,
        rules: {
          branch: profileForm.branch,
          marketKey: profileForm.marketKey,
          terminalKey: profileForm.terminalKey,
          ...normalizedRuleFields,
          ...extraRules
        }
      });
      setMessage("Terminal pricing profile saved.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to save terminal pricing profile"));
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveRuleWorkspace() {
    setSavingRule(true);
    setError("");
    setMessage("");
    try {
      const vendorSets = vendorSetRows
        .filter((row) => row.selectionMode && row.vendorsCsv.trim())
        .map((row) => ({
          selectionMode: row.selectionMode,
          productFamily: row.productFamily || ruleForm.productFamily,
          marketKey: row.marketKey || "",
          basisMode: row.basisMode || "match_rule_vendor",
          vendors: row.vendorsCsv.split(",").map((item) => item.trim()).filter(Boolean)
        }));
      let ruleId = selectedRuleId;
      if (!ruleId) {
        const created = await api.createPricingRule(ruleForm);
        ruleId = created?.id || "";
      } else {
        await api.updatePricingRule(ruleId, ruleForm);
      }
      if (ruleId) {
        await api.savePricingRuleVendorSets(ruleId, vendorSets);
        await reloadRules(ruleId);
      }
      setMessage(ruleId && selectedRuleId ? "Pricing rule saved." : "Pricing rule created.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to save pricing rule"));
    } finally {
      setSavingRule(false);
    }
  }

  async function deleteRuleWorkspace() {
    if (!selectedRuleId) return;
    const currentRule = pricingRules.find((row) => row.id === selectedRuleId);
    if (!window.confirm(`Delete pricing rule ${currentRule?.name || selectedRuleId}?`)) return;
    setSavingRule(true);
    setError("");
    setMessage("");
    try {
      await api.deletePricingRule(selectedRuleId);
      const remainingRules = pricingRules.filter((row) => row.id !== selectedRuleId);
      const nextRuleId = remainingRules[0]?.id || "";
      if (!nextRuleId) {
        createRuleDraft();
        setPricingRules([]);
      } else {
        setSelectedRuleId(nextRuleId);
      }
      await reloadRules(nextRuleId);
      setMessage("Pricing rule deleted.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to delete pricing rule"));
    } finally {
      setSavingRule(false);
    }
  }

  async function saveUser(event) {
    event.preventDefault();
    setSavingUser(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        name: userForm.name.trim(),
        email: userForm.email.trim(),
        role: userForm.role,
        jobberId: isSystemScope ? (userForm.jobberId || activeJobberId) : activeJobberId,
        siteIds: userForm.role === "manager" ? userForm.siteIds : []
      };
      if (userForm.password.trim()) payload.password = userForm.password.trim();
      if (selectedUserId) {
        await api.updateManagedUser(selectedUserId, payload);
        setMessage("User updated.");
      } else {
        await api.createManagedUser(payload);
        setMessage("User created.");
      }
      await reloadManagementOverview();
      clearUserWorkspace();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to save user"));
    } finally {
      setSavingUser(false);
    }
  }

  async function removeUser() {
    if (!selectedUser) return;
    if (!window.confirm(`Delete user ${selectedUser.email}?`)) return;
    setSavingUser(true);
    setError("");
    setMessage("");
    try {
      await api.deleteManagedUser(selectedUser.id);
      await reloadManagementOverview();
      clearUserWorkspace();
      setMessage("User deleted.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError || "Unable to delete user"));
    } finally {
      setSavingUser(false);
    }
  }

  function openAdminTask(nextTab, nextFocus = "") {
    setTab(nextTab);
    setTaskFocus(nextFocus);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function backToOverview() {
    setTab("overview");
    setTaskFocus("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const showFocusedMobileTask = isPhone && taskFocus && tab !== "overview";
  const showAdminShell = !showFocusedMobileTask;

  return (
    <Stack spacing={3}>
      {showAdminShell ? (
        <>
          {loading ? <LinearProgress /> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {message ? <Alert severity="success">{message}</Alert> : null}
          {!canManage ? <Alert severity="info">This workspace is read-only unless the current user has a jobber admin role.</Alert> : null}

          <Section title="Workspace" subtitle="Choose one admin task at a time so the page stays readable on a phone.">
            <Tabs
              value={tab}
              onChange={(_event, nextTab) => {
                setTab(nextTab);
                setTaskFocus("");
              }}
              variant="scrollable"
              allowScrollButtonsMobile
            >
              {TABS.map((value) => <Tab key={value} value={value} label={adminTabLabel(value)} />)}
            </Tabs>
          </Section>
        </>
      ) : (
        <>
          {loading ? <LinearProgress /> : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          {message ? <Alert severity="success">{message}</Alert> : null}
          {!canManage ? <Alert severity="info">This workspace is read-only unless the current user has a jobber admin role.</Alert> : null}
        </>
      )}

      {showFocusedMobileTask ? (
        <Stack spacing={2.5}>
          <Button variant="text" onClick={backToOverview}>
            Back to Admin
          </Button>

          {taskFocus === "branding" ? (
            <>
              <Section title="Branding Task" subtitle="Focused branding work for this jobber.">
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    Current status: {jobber?.logoUrl ? "A logo is already loaded." : "No logo is configured yet."}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Next step: upload a logo file or paste a logo URL/base64 value, then save branding below.
                  </Typography>
                </Stack>
              </Section>

              <Section title="Branding" subtitle="Keep jobber identity controls together and below the status summary.">
                <Grid container spacing={2.5}>
                  <Grid size={{ xs: 12, lg: 4 }}>
                    <Paper variant="outlined" sx={{ p: 2, minHeight: 220, display: "grid", placeItems: "center", backgroundColor: "background.default" }}>
                      {brandingForm.logoUrl ? (
                        <Box component="img" src={brandingForm.logoUrl} alt={brandingForm.name || "Jobber logo"} sx={{ maxWidth: "100%", maxHeight: 160, objectFit: "contain" }} />
                      ) : (
                        <Typography color="text.secondary">No logo configured</Typography>
                      )}
                    </Paper>
                  </Grid>
                  <Grid size={{ xs: 12, lg: 8 }}>
                    <Box component="form" onSubmit={saveBranding}>
                      <Stack spacing={2}>
                        <TextField
                          label="Jobber Name"
                          value={brandingForm.name}
                          onChange={(event) => setBrandingForm((current) => ({ ...current, name: event.target.value }))}
                          fullWidth
                          disabled={!canManage || savingBranding}
                        />
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                          <Button component="label" variant="outlined" disabled={!canManage || savingBranding}>
                            Upload Logo
                            <input hidden type="file" accept="image/*" onChange={(event) => onLogoFileSelected(event.target.files?.[0])} />
                          </Button>
                          <Button type="button" variant="text" onClick={() => setBrandingForm((current) => ({ ...current, logoUrl: "" }))} disabled={!canManage || savingBranding}>
                            Clear Logo
                          </Button>
                          <Button type="submit" variant="contained" disabled={!canManage || savingBranding}>
                            Save Branding
                          </Button>
                        </Stack>
                      </Stack>
                    </Box>
                  </Grid>
                </Grid>
              </Section>
            </>
          ) : null}

          {taskFocus === "opis" ? (
            <>
              <Section title="OPIS Task" subtitle="Focused OPIS setup for this jobber.">
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    Current status: {opisStatus?.saved ? `Configured. Last updated ${formatDateTime(opisStatus?.updatedAt)}.` : "Missing. OPIS credentials have not been saved yet."}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Next step: enter the OPIS username and password below, then tap `Save OPIS`.
                  </Typography>
                </Stack>
              </Section>

              <Section title="OPIS Credentials" subtitle="Stored securely at the jobber level.">
                <Box component="form" onSubmit={saveOpis}>
                  <Stack spacing={2}>
                    <TextField
                      label="Username"
                      value={opisForm.username}
                      onChange={(event) => setOpisForm((current) => ({ ...current, username: event.target.value }))}
                      fullWidth
                      disabled={!canManage || savingOpis}
                    />
                    <TextField
                      label="Password"
                      type="password"
                      value={opisForm.password}
                      onChange={(event) => setOpisForm((current) => ({ ...current, password: event.target.value }))}
                      fullWidth
                      disabled={!canManage || savingOpis}
                    />
                    <Button type="submit" variant="contained" disabled={!canManage || savingOpis}>
                      Save OPIS
                    </Button>
                  </Stack>
                </Box>
              </Section>
            </>
          ) : null}

          {taskFocus === "eia" ? (
            <>
              <Section title="EIA Task" subtitle="Focused EIA setup for this jobber.">
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    Current status: {eiaStatus?.saved ? `Configured. Last updated ${formatDateTime(eiaStatus?.updatedAt)}.` : "Missing. No EIA API key is saved yet."}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Next step: paste the EIA API key below, then tap `Save EIA Key`.
                  </Typography>
                </Stack>
              </Section>

              <Section title="EIA API Key" subtitle="Stored securely at the jobber level.">
                <Box component="form" onSubmit={saveEia}>
                  <Stack spacing={2}>
                    <TextField
                      label="API Key"
                      value={eiaForm.apiKey}
                      onChange={(event) => setEiaForm((current) => ({ ...current, apiKey: event.target.value }))}
                      fullWidth
                      multiline
                      minRows={3}
                      disabled={!canManage || savingEia}
                    />
                    <Button type="submit" variant="contained" disabled={!canManage || savingEia}>
                      Save EIA Key
                    </Button>
                  </Stack>
                </Box>
              </Section>
            </>
          ) : null}

          {taskFocus === "pricing" ? (
            <>
              <Section title="Pricing Task" subtitle="Focused review of current jobber pricing configuration.">
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    Current status: {pricingSummary.total > 0 ? `${pricingSummary.total.toLocaleString()} pricing config rows are loaded across ${pricingSummary.markets.toLocaleString()} markets.` : "No pricing config rows are loaded for this jobber."}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Next step: review the pricing rows below and confirm the correct markets, products, and margin settings are present.
                  </Typography>
                </Stack>
              </Section>

              <Section title="Pricing Config Rows" subtitle="Read-only in this first MUI admin slice.">
                <Stack spacing={1.25}>
                  {pricingConfigs.length ? pricingConfigs.slice(0, 24).map((row, index) => (
                    <Paper key={`${row.id || row.marketKey || "pricing"}-${index}`} variant="outlined" sx={{ p: 1.5 }}>
                      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
                        <Box>
                          <Typography fontWeight={700}>{row.marketLabel || row.location || row.marketKey || "Pricing Row"}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {[row.productKey, row.terminalKey, row.marketKey].filter(Boolean).join(" | ") || "No canonical keys"}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          {row.marginCents != null || row.margin != null ? <Chip size="small" variant="outlined" label={`Margin ${row.marginCents ?? row.margin}`} /> : null}
                          {row.freightCents != null ? <Chip size="small" variant="outlined" label={`Freight ${row.freightCents}`} /> : null}
                        </Stack>
                      </Stack>
                    </Paper>
                  )) : <Typography color="text.secondary">No jobber pricing configs were returned.</Typography>}
                </Stack>
              </Section>
            </>
          ) : null}

          {taskFocus === "profiles" ? (
            <>
              <Section title="Terminal Profiles Task" subtitle="Focused terminal-profile editing for pricing and landed-cost settings.">
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    Current status: {customers.length ? `${customers.length.toLocaleString()} terminals are available for profile editing.` : "No terminals are loaded yet."}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Next step: choose a terminal, update the profile fields below, then save the terminal and profile sections.
                  </Typography>
                </Stack>
              </Section>

              <Section title="Terminal Profiles" subtitle="Terminal setup moved here from Price Tables.">
                <Stack spacing={2}>
                  <Stack direction="row" justifyContent="space-between" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip label={isNewCustomerDraft ? "New terminal draft" : selectedCustomer?.name || "No terminal selected"} color="primary" variant="outlined" />
                    <Button variant="outlined" onClick={createCustomerProfileCustomer} disabled={savingCustomer}>
                      New Terminal
                    </Button>
                  </Stack>

                    <TextField
                      select
                      label="Terminal"
                      value={selectedCustomerId}
                      onChange={(event) => {
                        setIsNewCustomerDraft(false);
                        setSelectedCustomerId(event.target.value);
                      }}
                      fullWidth
                    >
                    {customers.length ? customers.map((customer) => (
                      <MenuItem key={customer.id} value={customer.id}>{customer.name}</MenuItem>
                    )) : <MenuItem value="" disabled>No terminals available</MenuItem>}
                  </TextField>

                  {selectedCustomerId || isNewCustomerDraft ? (
                    <>
                      <Grid container spacing={2}>
                        {["name", "addressLine1", "addressLine2", "city", "state", "postalCode"].map((field) => (
                          <Grid key={field} size={{ xs: 12, md: 6 }}>
                            <TextField
                              label={field}
                              value={customerForm[field] ?? ""}
                              onChange={(event) => setCustomerForm((current) => ({ ...current, [field]: event.target.value }))}
                              fullWidth
                              disabled={savingCustomer}
                            />
                          </Grid>
                        ))}
                        <Grid size={{ xs: 12, md: 6 }}>
                          <TextField
                            select
                            label="terminalKey"
                            value={customerForm.terminalKey}
                            onChange={(event) => setCustomerForm((current) => ({ ...current, terminalKey: event.target.value }))}
                            fullWidth
                            disabled={savingCustomer}
                          >
                            <MenuItem value="">Select terminal</MenuItem>
                            {TERMINAL_KEY_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                          </TextField>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                          <TextField
                            select
                            label="status"
                            value={customerForm.status}
                            onChange={(event) => setCustomerForm((current) => ({ ...current, status: event.target.value }))}
                            fullWidth
                            disabled={savingCustomer}
                          >
                            {CUSTOMER_STATUS_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                          </TextField>
                        </Grid>
                      </Grid>

                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                        <Button variant="contained" onClick={saveCustomerProfileCustomer} disabled={savingCustomer}>
                          {isNewCustomerDraft ? "Create Terminal" : "Save Terminal"}
                        </Button>
                        {!isNewCustomerDraft ? (
                          <Button variant="outlined" color="error" onClick={deleteCustomerProfileCustomer} disabled={savingCustomer}>
                            Delete Terminal
                          </Button>
                        ) : null}
                      </Stack>

                      {isNewCustomerDraft ? (
                        <Typography color="text.secondary">
                          Create the terminal first, then the pricing profile fields will be available here.
                        </Typography>
                      ) : (
                        <>
                          <Grid container spacing={2}>
                            {["distributionLabel", "gasPrepay", "dieselPrepay", "storageFee", "gasFedExcise", "gasStateExcise", "dieselFedExcise", "dieselStateExcise", "gasSalesTaxRate", "dieselSalesTaxRate", "gasRetailMargin", "dieselRetailMargin", "effectiveStart", "effectiveEnd", "freightMiles", "freightCostGas", "freightCostDiesel", "rackMarginGas", "rackMarginDiesel", "discountRegular", "discountMid", "discountPremium", "discountDiesel"].map((field) => (
                              <Grid key={field} size={{ xs: 12, md: 6 }}>
                                <TextField
                                  label={field}
                                  type={field.includes("Start") || field.includes("End") ? "date" : "text"}
                                  value={profileForm[field] ?? ""}
                                  onChange={(event) => setProfileForm((current) => ({ ...current, [field]: event.target.value }))}
                                  fullWidth
                                  InputLabelProps={field.includes("Start") || field.includes("End") ? { shrink: true } : undefined}
                                  disabled={savingProfile}
                                />
                              </Grid>
                            ))}
                            <Grid size={{ xs: 12, md: 4 }}>
                              <TextField
                                select
                                label="branch"
                                value={profileForm.branch}
                                onChange={(event) => setProfileForm((current) => ({ ...current, branch: event.target.value }))}
                                fullWidth
                                disabled={savingProfile}
                              >
                                {PRICING_BRANCH_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                              </TextField>
                            </Grid>
                            <Grid size={{ xs: 12, md: 4 }}>
                              <TextField
                                select
                                label="marketKey"
                                value={profileForm.marketKey}
                                onChange={(event) => setProfileForm((current) => ({ ...current, marketKey: event.target.value }))}
                                fullWidth
                                disabled={savingProfile}
                              >
                                <MenuItem value="">Select market</MenuItem>
                                {MARKET_KEY_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                              </TextField>
                            </Grid>
                            <Grid size={{ xs: 12, md: 4 }}>
                              <TextField
                                select
                                label="terminalKey"
                                value={profileForm.terminalKey}
                                onChange={(event) => setProfileForm((current) => ({ ...current, terminalKey: event.target.value }))}
                                fullWidth
                                disabled={savingProfile}
                              >
                                <MenuItem value="">Select terminal</MenuItem>
                                {TERMINAL_KEY_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                              </TextField>
                            </Grid>
                            <Grid size={{ xs: 12 }}>
                              <TextField
                                label="extraRulesJson"
                                value={profileForm.extraRulesJson}
                                onChange={(event) => setProfileForm((current) => ({ ...current, extraRulesJson: event.target.value }))}
                                multiline
                                minRows={6}
                                fullWidth
                                disabled={savingProfile}
                              />
                            </Grid>
                          </Grid>

                          <Button variant="contained" onClick={saveCustomerProfile} disabled={savingProfile}>
                            Save Profile
                          </Button>
                        </>
                      )}
                    </>
                  ) : (
                    <Typography color="text.secondary">Choose a terminal to edit the pricing profile.</Typography>
                  )}
                </Stack>
              </Section>
            </>
          ) : null}

          {taskFocus === "rules" ? (
            <>
              <Section title="Pricing Rules Task" subtitle="Focused rule editing for rack and spot selection.">
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary">
                    Current status: {pricingRules.length ? `${pricingRules.length.toLocaleString()} pricing rules are available.` : "No pricing rules are loaded yet."}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Next step: choose a rule, update the vendor set or status, then save the rule.
                  </Typography>
                </Stack>
              </Section>

              <Section title="Pricing Rules" subtitle="Edit active rule metadata and vendor-set selection.">
                <Stack spacing={2}>
                  <Stack direction="row" justifyContent="space-between" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip label={ruleForm.name || "New rule draft"} color="primary" variant="outlined" />
                    <Button variant="outlined" onClick={createRuleDraft} disabled={savingRule}>
                      New Rule
                    </Button>
                  </Stack>

                  <TextField select label="Rule" value={selectedRuleId} onChange={(event) => setSelectedRuleId(event.target.value)} fullWidth>
                    {pricingRules.length ? pricingRules.map((rule) => (
                      <MenuItem key={rule.id} value={rule.id}>{rule.name}</MenuItem>
                    )) : <MenuItem value="" disabled>No rules available</MenuItem>}
                  </TextField>

                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <TextField label="name" value={ruleForm.name} onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))} fullWidth disabled={savingRule} />
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <TextField select label="productFamily" value={ruleForm.productFamily} onChange={(event) => {
                        const nextFamily = event.target.value;
                        setRuleForm((current) => ({ ...current, productFamily: nextFamily }));
                        setVendorSetRows((current) => current.map((row) => ({ ...row, productFamily: nextFamily })));
                      }} fullWidth disabled={savingRule}>
                        {PRODUCT_FAMILY_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <TextField select label="status" value={ruleForm.status} onChange={(event) => setRuleForm((current) => ({ ...current, status: event.target.value }))} fullWidth disabled={savingRule}>
                        {RULE_STATUS_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <TextField label="versionLabel" value={ruleForm.versionLabel} onChange={(event) => setRuleForm((current) => ({ ...current, versionLabel: event.target.value }))} fullWidth disabled={savingRule} />
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <TextField label="effectiveStart" type="date" value={ruleForm.effectiveStart || ""} onChange={(event) => setRuleForm((current) => ({ ...current, effectiveStart: event.target.value }))} fullWidth InputLabelProps={{ shrink: true }} disabled={savingRule} />
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <TextField label="effectiveEnd" type="date" value={ruleForm.effectiveEnd || ""} onChange={(event) => setRuleForm((current) => ({ ...current, effectiveEnd: event.target.value }))} fullWidth InputLabelProps={{ shrink: true }} disabled={savingRule} />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <TextField label="notes" value={ruleForm.notes || ""} onChange={(event) => setRuleForm((current) => ({ ...current, notes: event.target.value }))} fullWidth multiline minRows={3} disabled={savingRule} />
                    </Grid>
                  </Grid>

                  <Section
                    title="Vendor Sets"
                    subtitle="These vendors determine whether rack values resolve."
                    action={<Chip clickable label="?" variant="outlined" onClick={() => setShowVendorSetHelp((current) => !current)} />}
                  >
                    <Stack spacing={1.5}>
                      {showVendorSetHelp ? (
                        <Alert severity="info">
                          <Stack spacing={0.75}>
                            {VENDOR_SET_HELP_LINES.map((item) => (
                              <Typography key={`mobile-help-${item.label}`} variant="body2">
                                <strong>{item.label}</strong>: {item.description}
                              </Typography>
                            ))}
                          </Stack>
                        </Alert>
                      ) : null}
                      {vendorSetRows.map((row, index) => (
                        <Paper key={`vendor-set-mobile-${index}`} variant="outlined" sx={{ p: 1.5 }}>
                          <Stack spacing={1.5}>
                            <Grid container spacing={2}>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField select label="selectionMode" value={row.selectionMode} onChange={(event) => updateVendorSetRow(index, "selectionMode", event.target.value)} fullWidth disabled={savingRule}>
                                  {VENDOR_SELECTION_MODE_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField select label="marketKey" value={row.marketKey} onChange={(event) => updateVendorSetRow(index, "marketKey", event.target.value)} fullWidth disabled={savingRule}>
                                  <MenuItem value="">All markets</MenuItem>
                                  {MARKET_KEY_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField select label="productFamily" value={row.productFamily} onChange={(event) => updateVendorSetRow(index, "productFamily", event.target.value)} fullWidth disabled={savingRule}>
                                  {PRODUCT_FAMILY_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField select label="basisMode" value={row.basisMode} onChange={(event) => updateVendorSetRow(index, "basisMode", event.target.value)} fullWidth disabled={savingRule}>
                                  {VENDOR_BASIS_MODE_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid size={{ xs: 12 }}>
                                <Stack spacing={1}>
                                  <Typography variant="body2" color="text.secondary">
                                    Vendors
                                  </Typography>
                                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                    {VENDOR_KEY_OPTIONS.map((option) => {
                                      const selected = row.vendorsCsv.split(",").map((item) => item.trim()).filter(Boolean).includes(option.value);
                                      return (
                                        <Chip
                                          key={`vendor-picker-mobile-${index}-${option.value}`}
                                          label={option.label}
                                          clickable
                                          color={selected ? "primary" : "default"}
                                          variant={selected ? "filled" : "outlined"}
                                          onClick={() => !savingRule && toggleVendorInRow(index, option.value)}
                                        />
                                      );
                                    })}
                                  </Stack>
                                  <Typography variant="caption" color="text.secondary">
                                    Selected keys: {row.vendorsCsv || "none"}
                                  </Typography>
                                </Stack>
                              </Grid>
                            </Grid>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                {row.vendorsCsv.split(",").map((item) => item.trim()).filter(Boolean).map((vendor) => (
                                  <Chip key={`vendor-mobile-${index}-${vendor}`} size="small" label={VENDOR_KEY_OPTIONS.find((option) => option.value === vendor)?.label || vendor} />
                                ))}
                              </Stack>
                              <Button color="error" onClick={() => removeVendorSetRow(index)} disabled={savingRule || vendorSetRows.length === 1}>Remove</Button>
                            </Stack>
                          </Stack>
                        </Paper>
                      ))}
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                        <Button variant="outlined" onClick={addVendorSetRow} disabled={savingRule}>Add Vendor Set</Button>
                        <Button variant="contained" onClick={saveRuleWorkspace} disabled={savingRule}>{selectedRuleId ? "Save Rule" : "Create Rule"}</Button>
                        {selectedRuleId ? (
                          <Button variant="outlined" color="error" onClick={deleteRuleWorkspace} disabled={savingRule}>Delete Rule</Button>
                        ) : null}
                      </Stack>
                    </Stack>
                  </Section>
                </Stack>
              </Section>
            </>
          ) : null}
        </Stack>
      ) : null}

      {!showFocusedMobileTask && tab === "overview" ? (
        <Stack spacing={2.5}>
          <Section title="Current Status" subtitle="High-level admin health for the current jobber.">
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6, md: 3 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Branding</Typography>
                  <Typography fontWeight={700}>{brandingForm.name || "Unnamed"}</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">OPIS Status</Typography>
                  <Typography fontWeight={700}>{opisStatus?.saved ? "Configured" : "Missing"}</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">EIA Status</Typography>
                  <Typography fontWeight={700}>{eiaStatus?.saved ? "Configured" : "Missing"}</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Pricing Rows</Typography>
                  <Typography fontWeight={700}>{pricingSummary.total.toLocaleString()}</Typography>
                </Paper>
              </Grid>
            </Grid>
          </Section>

          <Section title="Recommended Next Actions" subtitle="This keeps the admin migration focused instead of rebuilding the full legacy tool immediately.">
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip
                clickable
                onClick={() => openAdminTask("branding", "branding")}
                color={statusTone(!jobber?.logoUrl)}
                label={jobber?.logoUrl ? "Logo loaded" : "Add logo"}
              />
              <Chip
                clickable
                onClick={() => openAdminTask("credentials", "opis")}
                color={statusTone(!opisStatus?.saved)}
                label={opisStatus?.saved ? "OPIS configured" : "Configure OPIS"}
              />
              <Chip
                clickable
                onClick={() => openAdminTask("credentials", "eia")}
                color={statusTone(!eiaStatus?.saved)}
                label={eiaStatus?.saved ? "EIA configured" : "Configure EIA"}
              />
              <Chip
                clickable
                onClick={() => openAdminTask("pricing", "pricing")}
                color={statusTone(pricingSummary.total > 0)}
                label={pricingSummary.total > 0 ? "Pricing configs loaded" : "Review pricing configs"}
              />
                <Chip
                  clickable
                  onClick={() => openAdminTask("profiles", "profiles")}
                  color={statusTone(customers.length > 0)}
                  label={customers.length ? "Terminal profiles" : "Load terminal profiles"}
                />
                <Chip
                  clickable
                  onClick={() => openAdminTask("rules", "rules")}
                  color={statusTone(pricingRules.length > 0)}
                  label={pricingRules.length ? "Pricing rules" : "Load pricing rules"}
                />
              </Stack>
            </Section>
        </Stack>
      ) : null}

      {!showFocusedMobileTask && tab === "users" ? (
        <Stack spacing={2.5}>
          <Section title="User Summary" subtitle="Read the current user posture first, then edit below.">
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6, md: 3 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Visible Users</Typography>
                  <Typography fontWeight={700}>{filteredUsers.length.toLocaleString()}</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Admins</Typography>
                  <Typography fontWeight={700}>{roleCounts.admin.toLocaleString()}</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Managers</Typography>
                  <Typography fontWeight={700}>{roleCounts.manager.toLocaleString()}</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Visible Sites</Typography>
                  <Typography fontWeight={700}>{filteredSites.length.toLocaleString()}</Typography>
                </Paper>
              </Grid>
            </Grid>
          </Section>

          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, xl: 5 }}>
              <Section
                title="Users"
                subtitle="Select a user to edit, or start a new one."
                action={<Button variant="outlined" onClick={clearUserWorkspace}>New User</Button>}
              >
                <List disablePadding>
                  {filteredUsers.length ? filteredUsers.map((row) => (
                    <ListItem key={row.id} disablePadding sx={{ mb: 1 }}>
                      <ListItemButton
                        selected={selectedUserId === row.id}
                        onClick={() => setSelectedUserId(row.id)}
                        sx={{ border: "1px solid", borderColor: selectedUserId === row.id ? "primary.main" : "divider", borderRadius: 2 }}
                      >
                        <ListItemText
                          primary={row.name || row.email}
                          secondary={`${row.email} | ${row.role} | ${row.role === "manager" ? `${row.siteIds?.length || 0} sites` : "all sites"}`}
                        />
                      </ListItemButton>
                    </ListItem>
                  )) : <Typography color="text.secondary">No users returned for this jobber.</Typography>}
                </List>
              </Section>
            </Grid>

            <Grid size={{ xs: 12, xl: 7 }}>
              <Section title={selectedUser ? "Edit User" : "Add User"} subtitle="Write actions stay below the summary and list.">
                <Box component="form" onSubmit={saveUser}>
                  <Stack spacing={2}>
                    <TextField
                      label="Full Name"
                      value={userForm.name}
                      onChange={(event) => setUserForm((current) => ({ ...current, name: event.target.value }))}
                      fullWidth
                      disabled={!canManage || savingUser}
                    />
                    <TextField
                      label="Email"
                      value={userForm.email}
                      onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                      fullWidth
                      disabled={!canManage || savingUser}
                    />
                    <TextField
                      label={selectedUser ? "New Password (Optional)" : "Temporary Password"}
                      type="password"
                      value={userForm.password}
                      onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                      fullWidth
                      disabled={!canManage || savingUser}
                    />
                    <TextField
                      select
                      label="Role"
                      value={userForm.role}
                      onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value, siteIds: event.target.value === "admin" ? [] : current.siteIds }))}
                      fullWidth
                      disabled={!canManage || savingUser}
                    >
                      <MenuItem value="manager">Manager</MenuItem>
                      <MenuItem value="admin">Admin</MenuItem>
                    </TextField>

                    {userForm.role === "manager" ? (
                      <Paper variant="outlined" sx={{ p: 1.5 }}>
                        <Stack spacing={1.25}>
                          <Typography variant="subtitle2">Site Access</Typography>
                          <Typography variant="body2" color="text.secondary">
                            Managers only see checked sites. Leave all unchecked for no site access.
                          </Typography>
                          <Stack>
                            {availableSitesForUserForm.map((siteRow) => (
                              <FormControlLabel
                                key={siteRow.id}
                                control={<Checkbox checked={userForm.siteIds.includes(siteRow.id)} onChange={() => toggleUserSite(siteRow.id)} />}
                                label={`${siteRow.siteCode} - ${siteRow.name}`}
                                disabled={!canManage || savingUser}
                              />
                            ))}
                          </Stack>
                        </Stack>
                      </Paper>
                    ) : (
                      <Alert severity="info">Admins automatically see all sites for their jobber.</Alert>
                    )}

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                      <Button type="submit" variant="contained" disabled={!canManage || savingUser}>
                        {selectedUser ? "Save User" : "Create User"}
                      </Button>
                      {selectedUser ? (
                        <Button type="button" color="error" variant="outlined" onClick={removeUser} disabled={!canManage || savingUser}>
                          Delete User
                        </Button>
                      ) : null}
                      <Button type="button" variant="text" onClick={clearUserWorkspace} disabled={savingUser}>
                        Clear
                      </Button>
                    </Stack>
                  </Stack>
                </Box>
              </Section>
            </Grid>
          </Grid>
        </Stack>
      ) : null}

      {!showFocusedMobileTask && tab === "branding" ? (
        <Stack spacing={2.5}>
          {taskFocus === "branding" ? (
            <Section title="Branding Task" subtitle="Focused branding work for this jobber.">
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  Current status: {jobber?.logoUrl ? "A logo is already loaded." : "No logo is configured yet."}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Next step: upload a logo file or paste a logo URL/base64 value, then save branding below.
                </Typography>
              </Stack>
            </Section>
          ) : null}
          <Section title="Branding" subtitle="Keep jobber identity controls together and below the status summary.">
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, lg: 4 }}>
              <Paper variant="outlined" sx={{ p: 2, minHeight: 220, display: "grid", placeItems: "center", backgroundColor: "background.default" }}>
                {brandingForm.logoUrl ? (
                  <Box component="img" src={brandingForm.logoUrl} alt={brandingForm.name || "Jobber logo"} sx={{ maxWidth: "100%", maxHeight: 160, objectFit: "contain" }} />
                ) : (
                  <Typography color="text.secondary">No logo configured</Typography>
                )}
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, lg: 8 }}>
              <Box component="form" onSubmit={saveBranding}>
                <Stack spacing={2}>
                  <TextField
                    label="Jobber Name"
                    value={brandingForm.name}
                    onChange={(event) => setBrandingForm((current) => ({ ...current, name: event.target.value }))}
                    fullWidth
                    disabled={!canManage || savingBranding}
                  />
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                    <Button component="label" variant="outlined" disabled={!canManage || savingBranding}>
                      Upload Logo
                      <input hidden type="file" accept="image/*" onChange={(event) => onLogoFileSelected(event.target.files?.[0])} />
                    </Button>
                    <Button type="button" variant="text" onClick={() => setBrandingForm((current) => ({ ...current, logoUrl: "" }))} disabled={!canManage || savingBranding}>
                      Clear Logo
                    </Button>
                    <Button type="submit" variant="contained" disabled={!canManage || savingBranding}>
                      Save Branding
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            </Grid>
          </Grid>
          </Section>
        </Stack>
      ) : null}

      {!showFocusedMobileTask && tab === "credentials" ? (
        <Stack spacing={2.5}>
          {taskFocus === "opis" ? (
            <Section title="OPIS Task" subtitle="Focused OPIS setup for this jobber.">
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  Current status: {opisStatus?.saved ? `Configured. Last updated ${formatDateTime(opisStatus?.updatedAt)}.` : "Missing. OPIS credentials have not been saved yet."}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Next step: enter the OPIS username and password in the OPIS card below, then click `Save OPIS`.
                </Typography>
              </Stack>
            </Section>
          ) : null}
          {taskFocus === "eia" ? (
            <Section title="EIA Task" subtitle="Focused EIA setup for this jobber.">
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  Current status: {eiaStatus?.saved ? `Configured. Last updated ${formatDateTime(eiaStatus?.updatedAt)}.` : "Missing. No EIA API key is saved yet."}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Next step: paste the EIA API key in the EIA card below, then click `Save EIA Key`.
                </Typography>
              </Stack>
            </Section>
          ) : null}
          <Section title="Credential Status" subtitle="Read status first, then save changes below.">
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">OPIS</Typography>
                    <Chip label={opisStatus?.saved ? "Saved" : "Missing"} color={opisStatus?.saved ? "success" : "default"} sx={{ width: "fit-content" }} />
                    <Typography variant="caption" color="text.secondary">Last updated: {formatDateTime(opisStatus?.updatedAt)}</Typography>
                  </Stack>
                </Paper>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Stack spacing={1}>
                    <Typography variant="subtitle2">EIA</Typography>
                    <Chip label={eiaStatus?.saved ? "Saved" : "Missing"} color={eiaStatus?.saved ? "success" : "default"} sx={{ width: "fit-content" }} />
                    <Typography variant="caption" color="text.secondary">Last updated: {formatDateTime(eiaStatus?.updatedAt)}</Typography>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </Section>

          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, xl: 6 }}>
              <Section title="OPIS Credentials" subtitle="Stored securely at the jobber level.">
                <Box component="form" onSubmit={saveOpis}>
                  <Stack spacing={2}>
                    <TextField
                      label="Username"
                      value={opisForm.username}
                      onChange={(event) => setOpisForm((current) => ({ ...current, username: event.target.value }))}
                      fullWidth
                      disabled={!canManage || savingOpis}
                    />
                    <TextField
                      label="Password"
                      type="password"
                      value={opisForm.password}
                      onChange={(event) => setOpisForm((current) => ({ ...current, password: event.target.value }))}
                      fullWidth
                      disabled={!canManage || savingOpis}
                    />
                    <Button type="submit" variant="contained" disabled={!canManage || savingOpis}>
                      Save OPIS
                    </Button>
                  </Stack>
                </Box>
              </Section>
            </Grid>
            <Grid size={{ xs: 12, xl: 6 }}>
              <Section title="EIA API Key" subtitle="Stored securely at the jobber level.">
                <Box component="form" onSubmit={saveEia}>
                  <Stack spacing={2}>
                    <TextField
                      label="API Key"
                      value={eiaForm.apiKey}
                      onChange={(event) => setEiaForm((current) => ({ ...current, apiKey: event.target.value }))}
                      fullWidth
                      multiline
                      minRows={3}
                      disabled={!canManage || savingEia}
                    />
                    <Button type="submit" variant="contained" disabled={!canManage || savingEia}>
                      Save EIA Key
                    </Button>
                  </Stack>
                </Box>
              </Section>
            </Grid>
          </Grid>
        </Stack>
      ) : null}

      {!showFocusedMobileTask && tab === "rules" ? (
        <Stack spacing={2.5}>
          <Section
            title="Pricing Rules"
            subtitle="Edit active rule metadata and vendor sets for rack and spot selection."
            action={<Button variant="outlined" onClick={createRuleDraft} disabled={savingRule}>New Rule</Button>}
          >
            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, lg: 4 }}>
                <Stack spacing={1.25}>
                  <TextField
                    select
                    label="Rule"
                    value={selectedRuleId}
                    onChange={(event) => setSelectedRuleId(event.target.value)}
                    fullWidth
                  >
                    {pricingRules.length ? pricingRules.map((rule) => (
                      <MenuItem key={rule.id} value={rule.id}>{rule.name}</MenuItem>
                    )) : <MenuItem value="" disabled>No rules available</MenuItem>}
                  </TextField>
                  <Stack spacing={1}>
                    {pricingRules.length ? pricingRules.map((rule) => (
                      <Paper
                        key={rule.id}
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          cursor: "pointer",
                          borderColor: rule.id === selectedRuleId ? "primary.main" : undefined,
                          backgroundColor: rule.id === selectedRuleId ? "rgba(25, 118, 210, 0.06)" : undefined
                        }}
                        onClick={() => setSelectedRuleId(rule.id)}
                      >
                        <Stack direction="row" justifyContent="space-between" spacing={1}>
                          <Box>
                            <Typography fontWeight={700}>{rule.name}</Typography>
                            <Typography variant="body2" color="text.secondary">
                              {[rule.productFamily || "unknown", rule.status || "draft"].join(" | ")}
                            </Typography>
                          </Box>
                          <Chip size="small" variant="outlined" label={rule.versionLabel || "No version"} />
                        </Stack>
                      </Paper>
                    )) : <Typography color="text.secondary">No pricing rules are available yet.</Typography>}
                  </Stack>
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, lg: 8 }}>
                <Stack spacing={2.5}>
                  <Section title="Rule Metadata" subtitle="Rule family, status window, and version label.">
                    <Stack spacing={2}>
                      <Grid container spacing={2}>
                        <Grid size={{ xs: 12, md: 6 }}>
                          <TextField
                            label="name"
                            value={ruleForm.name}
                            onChange={(event) => setRuleForm((current) => ({ ...current, name: event.target.value }))}
                            fullWidth
                            disabled={savingRule}
                          />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                          <TextField
                            select
                            label="productFamily"
                            value={ruleForm.productFamily}
                            onChange={(event) => {
                              const nextFamily = event.target.value;
                              setRuleForm((current) => ({ ...current, productFamily: nextFamily }));
                              setVendorSetRows((current) => current.map((row) => ({ ...row, productFamily: nextFamily })));
                            }}
                            fullWidth
                            disabled={savingRule}
                          >
                            {PRODUCT_FAMILY_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                          </TextField>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                          <TextField
                            select
                            label="status"
                            value={ruleForm.status}
                            onChange={(event) => setRuleForm((current) => ({ ...current, status: event.target.value }))}
                            fullWidth
                            disabled={savingRule}
                          >
                            {RULE_STATUS_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                          </TextField>
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                          <TextField
                            label="versionLabel"
                            value={ruleForm.versionLabel}
                            onChange={(event) => setRuleForm((current) => ({ ...current, versionLabel: event.target.value }))}
                            fullWidth
                            disabled={savingRule}
                          />
                        </Grid>
                        <Grid size={{ xs: 12, md: 4 }}>
                          <Chip
                            color={statusTone(pricingRules.length > 0)}
                            variant="outlined"
                            label={selectedRuleId ? "Existing rule" : "New rule draft"}
                            sx={{ mt: 1 }}
                          />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                          <TextField
                            label="effectiveStart"
                            type="date"
                            value={ruleForm.effectiveStart || ""}
                            onChange={(event) => setRuleForm((current) => ({ ...current, effectiveStart: event.target.value }))}
                            fullWidth
                            InputLabelProps={{ shrink: true }}
                            disabled={savingRule}
                          />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                          <TextField
                            label="effectiveEnd"
                            type="date"
                            value={ruleForm.effectiveEnd || ""}
                            onChange={(event) => setRuleForm((current) => ({ ...current, effectiveEnd: event.target.value }))}
                            fullWidth
                            InputLabelProps={{ shrink: true }}
                            disabled={savingRule}
                          />
                        </Grid>
                        <Grid size={{ xs: 12 }}>
                          <TextField
                            label="notes"
                            value={ruleForm.notes || ""}
                            onChange={(event) => setRuleForm((current) => ({ ...current, notes: event.target.value }))}
                            fullWidth
                            multiline
                            minRows={3}
                            disabled={savingRule}
                          />
                        </Grid>
                      </Grid>
                    </Stack>
                  </Section>

                  <Section
                    title="Vendor Sets"
                    subtitle="These vendors determine whether rack values resolve for each market."
                    action={<Chip clickable label="?" variant="outlined" onClick={() => setShowVendorSetHelp((current) => !current)} />}
                  >
                    <Stack spacing={1.5}>
                      {showVendorSetHelp ? (
                        <Alert severity="info">
                          <Stack spacing={0.75}>
                            {VENDOR_SET_HELP_LINES.map((item) => (
                              <Typography key={`desktop-help-${item.label}`} variant="body2">
                                <strong>{item.label}</strong>: {item.description}
                              </Typography>
                            ))}
                          </Stack>
                        </Alert>
                      ) : null}
                      {vendorSetRows.map((row, index) => (
                        <Paper key={`vendor-set-desktop-${index}`} variant="outlined" sx={{ p: 1.5 }}>
                          <Stack spacing={1.5}>
                            <Grid container spacing={2}>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField
                                  select
                                  label="selectionMode"
                                  value={row.selectionMode}
                                  onChange={(event) => updateVendorSetRow(index, "selectionMode", event.target.value)}
                                  fullWidth
                                  disabled={savingRule}
                                >
                                  {VENDOR_SELECTION_MODE_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField
                                  select
                                  label="marketKey"
                                  value={row.marketKey}
                                  onChange={(event) => updateVendorSetRow(index, "marketKey", event.target.value)}
                                  fullWidth
                                  disabled={savingRule}
                                >
                                  <MenuItem value="">All markets</MenuItem>
                                  {MARKET_KEY_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField
                                  select
                                  label="productFamily"
                                  value={row.productFamily}
                                  onChange={(event) => updateVendorSetRow(index, "productFamily", event.target.value)}
                                  fullWidth
                                  disabled={savingRule}
                                >
                                  {PRODUCT_FAMILY_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField
                                  select
                                  label="basisMode"
                                  value={row.basisMode}
                                  onChange={(event) => updateVendorSetRow(index, "basisMode", event.target.value)}
                                  fullWidth
                                  disabled={savingRule}
                                >
                                  {VENDOR_BASIS_MODE_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid size={{ xs: 12 }}>
                                <Stack spacing={1}>
                                  <Typography variant="body2" color="text.secondary">
                                    Vendors
                                  </Typography>
                                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                    {VENDOR_KEY_OPTIONS.map((option) => {
                                      const selected = row.vendorsCsv.split(",").map((item) => item.trim()).filter(Boolean).includes(option.value);
                                      return (
                                        <Chip
                                          key={`vendor-picker-desktop-${index}-${option.value}`}
                                          label={option.label}
                                          clickable
                                          color={selected ? "primary" : "default"}
                                          variant={selected ? "filled" : "outlined"}
                                          onClick={() => !savingRule && toggleVendorInRow(index, option.value)}
                                        />
                                      );
                                    })}
                                  </Stack>
                                  <Typography variant="caption" color="text.secondary">
                                    Selected keys: {row.vendorsCsv || "none"}
                                  </Typography>
                                </Stack>
                              </Grid>
                            </Grid>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                                {row.vendorsCsv.split(",").map((item) => item.trim()).filter(Boolean).map((vendor) => (
                                  <Chip key={`vendor-desktop-${index}-${vendor}`} size="small" label={VENDOR_KEY_OPTIONS.find((option) => option.value === vendor)?.label || vendor} />
                                ))}
                              </Stack>
                              <Button color="error" onClick={() => removeVendorSetRow(index)} disabled={savingRule || vendorSetRows.length === 1}>
                                Remove
                              </Button>
                            </Stack>
                          </Stack>
                        </Paper>
                      ))}
                      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                        <Button variant="outlined" onClick={addVendorSetRow} disabled={savingRule}>Add Vendor Set</Button>
                        <Button variant="contained" onClick={saveRuleWorkspace} disabled={savingRule}>
                          {selectedRuleId ? "Save Rule" : "Create Rule"}
                        </Button>
                        {selectedRuleId ? (
                          <Button variant="outlined" color="error" onClick={deleteRuleWorkspace} disabled={savingRule}>
                            Delete Rule
                          </Button>
                        ) : null}
                      </Stack>
                    </Stack>
                  </Section>
                </Stack>
              </Grid>
            </Grid>
          </Section>
        </Stack>
      ) : null}

      {!showFocusedMobileTask && tab === "pricing" ? (
        <Stack spacing={2.5}>
          {taskFocus === "pricing" ? (
            <Section title="Pricing Task" subtitle="Focused review of current jobber pricing configuration.">
              <Stack spacing={1}>
                <Typography variant="body2" color="text.secondary">
                  Current status: {pricingSummary.total > 0 ? `${pricingSummary.total.toLocaleString()} pricing config rows are loaded across ${pricingSummary.markets.toLocaleString()} markets.` : "No pricing config rows are loaded for this jobber."}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Next step: review the pricing rows below and confirm the correct markets, products, and margin settings are present.
                </Typography>
              </Stack>
            </Section>
          ) : null}
          <Section title="Pricing Summary" subtitle="Status first, config rows below.">
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6, md: 3 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Config Rows</Typography>
                  <Typography fontWeight={700}>{pricingSummary.total.toLocaleString()}</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Markets</Typography>
                  <Typography fontWeight={700}>{pricingSummary.markets.toLocaleString()}</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">Custom Margins</Typography>
                  <Typography fontWeight={700}>{pricingSummary.withCustomMargin.toLocaleString()}</Typography>
                </Paper>
              </Grid>
            </Grid>
          </Section>

          <Section title="Pricing Config Rows" subtitle="Read-only in this first MUI admin slice.">
            <Stack spacing={1.25}>
              {pricingConfigs.length ? pricingConfigs.slice(0, 24).map((row, index) => (
                <Paper key={`${row.id || row.marketKey || "pricing"}-${index}`} variant="outlined" sx={{ p: 1.5 }}>
                  <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
                    <Box>
                      <Typography fontWeight={700}>{row.marketLabel || row.location || row.marketKey || "Pricing Row"}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {[row.productKey, row.terminalKey, row.marketKey].filter(Boolean).join(" | ") || "No canonical keys"}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {row.marginCents != null || row.margin != null ? <Chip size="small" variant="outlined" label={`Margin ${row.marginCents ?? row.margin}`} /> : null}
                      {row.freightCents != null ? <Chip size="small" variant="outlined" label={`Freight ${row.freightCents}`} /> : null}
                    </Stack>
                  </Stack>
                </Paper>
              )) : <Typography color="text.secondary">No jobber pricing configs were returned.</Typography>}
            </Stack>
          </Section>
        </Stack>
      ) : null}

      {!showFocusedMobileTask && tab === "tank-limits" ? (
        <Stack spacing={2.5}>
          <Section title="Tank Limits" subtitle="Set grade-specific percent bands for low red, low yellow, high yellow, and high red. Tank gauges use these values for color.">
            <Stack spacing={2}>
              <Alert severity="info">
                Red applies when a tank is too low or too high. Yellow is the warning band on either side. Green is the middle operating range.
              </Alert>
              <Grid container spacing={1.5}>
                {TANK_LIMIT_FAMILIES.map((family) => (
                  <Grid key={family.key} size={{ xs: 12, lg: 6 }}>
                    <Paper variant="outlined" sx={{ p: 2 }}>
                      <Stack spacing={1.5}>
                        <Typography variant="subtitle1" fontWeight={700}>{family.label}</Typography>
                        <Grid container spacing={1.5}>
                          <Grid size={{ xs: 6, md: 3 }}>
                            <TextField
                              label="Low Red Max"
                              type="number"
                              value={tankLimitsForm[family.key]?.lowRedMax ?? ""}
                              onChange={(event) => updateTankLimit(family.key, "lowRedMax", event.target.value)}
                              fullWidth
                              disabled={savingTankLimits}
                              sx={{
                                "& .MuiOutlinedInput-root": {
                                  background: "linear-gradient(90deg, rgba(209,67,67,0.28) 0%, rgba(209,67,67,0.24) 44%, rgba(199,119,0,0.2) 56%, rgba(199,119,0,0.24) 100%)"
                                }
                              }}
                            />
                          </Grid>
                          <Grid size={{ xs: 6, md: 3 }}>
                            <TextField
                              label="Low Yellow Max"
                              type="number"
                              value={tankLimitsForm[family.key]?.lowYellowMax ?? ""}
                              onChange={(event) => updateTankLimit(family.key, "lowYellowMax", event.target.value)}
                              fullWidth
                              disabled={savingTankLimits}
                              sx={{
                                "& .MuiOutlinedInput-root": {
                                  background: "linear-gradient(90deg, rgba(199,119,0,0.28) 0%, rgba(199,119,0,0.22) 44%, rgba(46,125,50,0.18) 56%, rgba(46,125,50,0.22) 100%)"
                                }
                              }}
                            />
                          </Grid>
                          <Grid size={{ xs: 6, md: 3 }}>
                            <TextField
                              label="High Yellow Min"
                              type="number"
                              value={tankLimitsForm[family.key]?.highYellowMin ?? ""}
                              onChange={(event) => updateTankLimit(family.key, "highYellowMin", event.target.value)}
                              fullWidth
                              disabled={savingTankLimits}
                              sx={{
                                "& .MuiOutlinedInput-root": {
                                  background: "linear-gradient(90deg, rgba(46,125,50,0.22) 0%, rgba(46,125,50,0.18) 44%, rgba(199,119,0,0.22) 56%, rgba(199,119,0,0.28) 100%)"
                                }
                              }}
                            />
                          </Grid>
                          <Grid size={{ xs: 6, md: 3 }}>
                            <TextField
                              label="High Red Min"
                              type="number"
                              value={tankLimitsForm[family.key]?.highRedMin ?? ""}
                              onChange={(event) => updateTankLimit(family.key, "highRedMin", event.target.value)}
                              fullWidth
                              disabled={savingTankLimits}
                              sx={{
                                "& .MuiOutlinedInput-root": {
                                  background: "linear-gradient(90deg, rgba(199,119,0,0.24) 0%, rgba(199,119,0,0.2) 44%, rgba(209,67,67,0.22) 56%, rgba(209,67,67,0.28) 100%)"
                                }
                              }}
                            />
                          </Grid>
                        </Grid>
                        <Typography variant="caption" color="text.secondary">
                          Green range: {tankLimitsForm[family.key]?.lowYellowMax}% to {tankLimitsForm[family.key]?.highYellowMin}%.
                        </Typography>
                      </Stack>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                <Button variant="contained" onClick={saveTankLimitsWorkspace} disabled={savingTankLimits}>
                  Save Tank Limits
                </Button>
              </Stack>
            </Stack>
          </Section>
        </Stack>
      ) : null}

      {!showFocusedMobileTask && tab === "version" ? (
        <Stack spacing={2.5}>
          <Section title="Version" subtitle="Current frontend and API release metadata for this deployment.">
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 12, md: 3 }}>
                <SummaryCard label="Frontend Version" value={appVersion} caption="This value comes from apps/web-mui/package.json and changes only for frontend work." />
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <SummaryCard label="Frontend Release" value={formatDateTime(appReleaseDateTime)} caption={`Recorded date: ${appReleaseDate}`} />
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <SummaryCard label="API Version" value={apiVersion} caption="This value comes from apps/api/package.json and must change for every API edit." />
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <SummaryCard label="API Release" value={formatDateTime(apiReleaseDateTime)} caption={`Recorded date: ${apiReleaseDate}`} />
              </Grid>
            </Grid>
          </Section>

          <Section title="Information on Changes" subtitle="Versioning and release notes must stay explicit and separate.">
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">
                Frontend and API versions are tracked independently. Do not force them to match.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                For frontend edits, update <strong>apps/web-mui/package.json</strong> with a new frontend version plus both the release date and release time.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                For API edits, update <strong>apps/api/package.json</strong> with a new API version plus both the release date and release time.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Current release info: frontend {appVersion} at {formatDateTime(appReleaseDateTime)}. API {apiVersion} at {formatDateTime(apiReleaseDateTime)}.
              </Typography>
            </Stack>
          </Section>
        </Stack>
      ) : null}

      {!showFocusedMobileTask && tab === "profiles" ? (
        <Stack spacing={2.5}>
          <Section
            title="Terminal Profiles"
            subtitle="Terminal pricing profiles live in Admin now instead of Price Tables."
            action={<Button variant="outlined" onClick={createCustomerProfileCustomer} disabled={savingCustomer}>New Terminal</Button>}
          >
            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, lg: 4 }}>
                <Stack spacing={1.25}>
                    <TextField
                      select
                      label="Terminal"
                      value={selectedCustomerId}
                      onChange={(event) => {
                        setIsNewCustomerDraft(false);
                        setSelectedCustomerId(event.target.value);
                      }}
                      fullWidth
                    >
                    {customers.length ? customers.map((customer) => (
                      <MenuItem key={customer.id} value={customer.id}>{customer.name}</MenuItem>
                    )) : <MenuItem value="" disabled>No terminals available</MenuItem>}
                  </TextField>
                  <Stack spacing={1}>
                    {customers.length ? customers.map((customer) => (
                      <Paper
                        key={customer.id}
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          cursor: "pointer",
                          borderColor: customer.id === selectedCustomerId ? "primary.main" : undefined,
                          backgroundColor: customer.id === selectedCustomerId ? "rgba(25, 118, 210, 0.06)" : undefined
                        }}
                        onClick={() => {
                          setIsNewCustomerDraft(false);
                          setSelectedCustomerId(customer.id);
                        }}
                      >
                        <Typography fontWeight={700}>{customer.name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {[customer.terminalKey || "No terminal", customer.status || "unknown"].join(" | ")}
                        </Typography>
                      </Paper>
                    )) : <Typography color="text.secondary">No terminals available yet.</Typography>}
                  </Stack>
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, lg: 8 }}>
                {selectedCustomerId || isNewCustomerDraft ? (
                  <Stack spacing={2.5}>
                    <Section title="Terminal" subtitle="Basic terminal profile fields used by pricing.">
                      <Stack spacing={2}>
                        <Grid container spacing={2}>
                          {["name", "addressLine1", "addressLine2", "city", "state", "postalCode"].map((field) => (
                            <Grid key={field} size={{ xs: 12, md: 6 }}>
                              <TextField
                                label={field}
                                value={customerForm[field] ?? ""}
                                onChange={(event) => setCustomerForm((current) => ({ ...current, [field]: event.target.value }))}
                                fullWidth
                                disabled={savingCustomer}
                              />
                            </Grid>
                          ))}
                          <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                              select
                              label="terminalKey"
                              value={customerForm.terminalKey}
                              onChange={(event) => setCustomerForm((current) => ({ ...current, terminalKey: event.target.value }))}
                              fullWidth
                              disabled={savingCustomer}
                            >
                              <MenuItem value="">Select terminal</MenuItem>
                              {TERMINAL_KEY_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                            </TextField>
                          </Grid>
                          <Grid size={{ xs: 12, md: 6 }}>
                            <TextField
                              select
                              label="status"
                              value={customerForm.status}
                              onChange={(event) => setCustomerForm((current) => ({ ...current, status: event.target.value }))}
                              fullWidth
                              disabled={savingCustomer}
                            >
                              {CUSTOMER_STATUS_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                            </TextField>
                          </Grid>
                        </Grid>
                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
                          <Button variant="contained" onClick={saveCustomerProfileCustomer} disabled={savingCustomer}>
                            {isNewCustomerDraft ? "Create Terminal" : "Save Terminal"}
                          </Button>
                          {!isNewCustomerDraft ? (
                            <Button variant="outlined" color="error" onClick={deleteCustomerProfileCustomer} disabled={savingCustomer}>
                              Delete Terminal
                            </Button>
                          ) : null}
                        </Stack>
                      </Stack>
                    </Section>

                    <Section title="Pricing Profile" subtitle="Landed-cost settings and routing moved here from Price Tables.">
                      <Stack spacing={2}>
                        {isNewCustomerDraft ? (
                          <Typography color="text.secondary">
                            Create the terminal first, then the pricing profile fields will be available here.
                          </Typography>
                        ) : (
                          <>
                            <Grid container spacing={2}>
                              {["distributionLabel", "gasPrepay", "dieselPrepay", "storageFee", "gasFedExcise", "gasStateExcise", "dieselFedExcise", "dieselStateExcise", "gasSalesTaxRate", "dieselSalesTaxRate", "gasRetailMargin", "dieselRetailMargin", "effectiveStart", "effectiveEnd", "freightMiles", "freightCostGas", "freightCostDiesel", "rackMarginGas", "rackMarginDiesel", "discountRegular", "discountMid", "discountPremium", "discountDiesel"].map((field) => (
                                <Grid key={field} size={{ xs: 12, md: 6 }}>
                                  <TextField
                                    label={field}
                                    type={field.includes("Start") || field.includes("End") ? "date" : "text"}
                                    value={profileForm[field] ?? ""}
                                    onChange={(event) => setProfileForm((current) => ({ ...current, [field]: event.target.value }))}
                                    fullWidth
                                    InputLabelProps={field.includes("Start") || field.includes("End") ? { shrink: true } : undefined}
                                    disabled={savingProfile}
                                  />
                                </Grid>
                              ))}
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField
                                  select
                                  label="branch"
                                  value={profileForm.branch}
                                  onChange={(event) => setProfileForm((current) => ({ ...current, branch: event.target.value }))}
                                  fullWidth
                                  disabled={savingProfile}
                                >
                                  {PRICING_BRANCH_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField
                                  select
                                  label="marketKey"
                                  value={profileForm.marketKey}
                                  onChange={(event) => setProfileForm((current) => ({ ...current, marketKey: event.target.value }))}
                                  fullWidth
                                  disabled={savingProfile}
                                >
                                  <MenuItem value="">Select market</MenuItem>
                                  {MARKET_KEY_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
                                <TextField
                                  select
                                  label="terminalKey"
                                  value={profileForm.terminalKey}
                                  onChange={(event) => setProfileForm((current) => ({ ...current, terminalKey: event.target.value }))}
                                  fullWidth
                                  disabled={savingProfile}
                                >
                                  <MenuItem value="">Select terminal</MenuItem>
                                  {TERMINAL_KEY_OPTIONS.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid size={{ xs: 12 }}>
                                <TextField
                                  label="extraRulesJson"
                                  value={profileForm.extraRulesJson}
                                  onChange={(event) => setProfileForm((current) => ({ ...current, extraRulesJson: event.target.value }))}
                                  multiline
                                  minRows={6}
                                  fullWidth
                                  disabled={savingProfile}
                                />
                              </Grid>
                            </Grid>
                            <Button variant="contained" onClick={saveCustomerProfile} disabled={savingProfile}>
                              Save Profile
                            </Button>
                          </>
                        )}
                      </Stack>
                    </Section>
                  </Stack>
                ) : (
                  <Section title="Terminal Profiles" subtitle="Choose a terminal to start editing the pricing profile.">
                    <Typography color="text.secondary">Select a terminal from the list to load profile fields.</Typography>
                  </Section>
                )}
              </Grid>
            </Grid>
          </Section>
        </Stack>
      ) : null}
    </Stack>
  );
}

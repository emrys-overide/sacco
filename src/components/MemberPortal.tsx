import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BadgeCheck,
  Bus,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  Database,
  Download,
  Eye,
  EyeOff,
  FileText,
  History,
  Home,
  KeyRound,
  Landmark,
  Loader2,
  LogOut,
  Mail,
  Maximize2,
  Minimize2,
  Phone,
  PlusCircle,
  Printer,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserRound,
  Wallet,
  Wifi,
} from "lucide-react";
import type {
  MemberLoanSummary,
  MemberPortalData,
  SaccoTransaction,
  SaccoTransactionType,
  User,
} from "../types";
import { fetchSaccoJson, postSaccoJson } from "../lib/api";
import {
  downloadLoanAgreementWord,
  isLoanAgreementAvailable,
  type LoanAgreementData,
  printLoanAgreement,
} from "../lib/loanAgreement";
import NotificationCenter from "./NotificationCenter";

export interface MemberPortalProps {
  data: MemberPortalData;
  token?: string;
  currentUser?: User;
  onApplicationCreated?: () => void | Promise<void>;
  onAccountSuspended?: () => void;
  onLogout?: () => void;
}

export type MobileAppTab = "home" | "pay" | "loans" | "activity" | "profile";

const repaymentPeriods = [1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60, 72, 84];
const loanTypes = [
  "General",
  "Emergency",
  "Development",
  "Education",
  "Business",
  "Vehicle",
];
const repaymentMethods = [
  "SACCO collection",
  "Salary deduction",
  "Bank standing order",
  "Mobile money",
  "Other",
];
const presetAmounts = [500, 1000, 2000, 5000, 10000];

function formatKes(amount: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(amount);
}

function initials(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "M"
  );
}

function formatPeriod(months?: number) {
  if (!months) return "Not set";
  if (months % 12 === 0)
    return `${months / 12} ${months === 1 ? "year" : "years"}`;
  return `${months} ${months === 1 ? "month" : "months"}`;
}

function loanIsOpen(status: string) {
  return [
    "Applied",
    "SecretaryReview",
    "TreasurerReview",
    "ChairmanReview",
    "Approved",
    "Active",
    "Defaulted",
  ].includes(status);
}

function agreementFromMemberLoan(
  loan: MemberLoanSummary,
  data: MemberPortalData,
): LoanAgreementData {
  const snapshot = loan.applicationSnapshot;
  return {
    id: loan.id,
    status: loan.status,
    memberName: snapshot?.fullName || data.profile.fullName,
    membershipNumber:
      snapshot?.membershipNumber || data.profile.membershipNumber,
    nationalId: snapshot?.nationalId || data.profile.nationalId,
    phone: snapshot?.phone || data.profile.phone,
    email: snapshot?.email || data.profile.email,
    loanType: loan.loanType,
    applicationDate: loan.applicationDate,
    principalAmount: loan.principalAmount,
    interestRate: loan.interestRate || 0,
    totalPayable: loan.totalPayable,
    repaymentPeriodMonths: loan.repaymentPeriodMonths,
    repaymentMethod: loan.repaymentMethod,
    incomeSource: loan.incomeSource,
    monthlyIncome: loan.monthlyIncome,
    guarantorDetails: loan.guarantorDetails,
    collateralDetails: loan.collateralDetails,
    purposeNotes: loan.notes,
    issueDate: loan.issueDate,
    dueDate: loan.dueDate,
    approvedAt: loan.approvedAt,
    disbursedAt: loan.disbursedAt,
    memberSavings: data.member.savingsAmount,
    secretaryName: loan.secretaryName,
    secretaryReviewedAt: loan.secretaryReviewedAt,
    secretaryNotes: loan.secretaryNotes,
    treasurerName: loan.treasurerName,
    treasurerReviewedAt: loan.treasurerReviewedAt,
    treasurerNotes: loan.treasurerNotes,
    chairmanName: loan.chairmanName,
  };
}

export default function MemberPortal({
  data,
  token: propToken,
  onApplicationCreated,
  onAccountSuspended,
  onLogout,
}: MemberPortalProps) {
  const effectiveToken =
    propToken ||
    (typeof window !== "undefined"
      ? window.localStorage.getItem("sowetamu_sacco_auth_token_v1") || ""
      : "");

  // Mobile App Shell Navigation & Display State
  const [activeTab, setActiveTab] = useState<MobileAppTab>("home");
  const [phoneFrameMode, setPhoneFrameMode] = useState<boolean>(true);
  const [hideBalances, setHideBalances] = useState<boolean>(false);
  const [activityFilter, setActivityFilter] = useState<
    "ALL" | "SAVINGS" | "LOANS" | "STK"
  >("ALL");
  const [activitySearch, setActivitySearch] = useState<string>("");

  // M-Pesa Express (Daraja STK Push) Payment Form State
  const defaultVehiclePlate =
    data.vehicles[0]?.plateNumber || data.member.vehicleAssigned || "";
  const [payVehiclePlate, setPayVehiclePlate] = useState(defaultVehiclePlate);
  const [payPurpose, setPayPurpose] = useState<SaccoTransactionType>("SAVINGS");
  const [payAmount, setPayAmount] = useState<string>("1000");
  const [payPhone, setPayPhone] = useState<string>(data.profile.phone || "");
  const [simulateLag, setSimulateLag] = useState<boolean>(false);

  const [stkStep, setStkStep] = useState<
    | "IDLE"
    | "SENDING"
    | "AWAITING_PIN"
    | "LAGGED"
    | "VERIFYING"
    | "SUCCESS"
    | "FAILED"
  >("IDLE");
  const [activeStkTx, setActiveStkTx] = useState<SaccoTransaction | null>(null);
  const [stkFeedback, setStkFeedback] = useState<string>("");
  const [stkFlaggedLag, setStkFlaggedLag] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  // Loan Application State
  const [amount, setAmount] = useState("");
  const [loanType, setLoanType] = useState("General");
  const [repaymentPeriodMonths, setRepaymentPeriodMonths] = useState("12");
  const [repaymentMethod, setRepaymentMethod] = useState("SACCO collection");
  const [incomeSource, setIncomeSource] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [guarantorDetails, setGuarantorDetails] = useState("");
  const [collateralDetails, setCollateralDetails] = useState("");
  const [notes, setNotes] = useState("");
  const [loanMessage, setLoanMessage] = useState("");
  const [showLoanForm, setShowLoanForm] = useState(false);

  // Settings / Profile State
  const [settingsEmail, setSettingsEmail] = useState(data.profile.email);
  const [profilePhotoData, setProfilePhotoData] = useState<string | undefined>(
    data.profile.profilePhotoData,
  );
  const [settingsMessage, setSettingsMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSettingsEmail(data.profile.email);
    setProfilePhotoData(data.profile.profilePhotoData);
  }, [data.profile.email, data.profile.profilePhotoData]);

  useEffect(() => {
    if (!payVehiclePlate && defaultVehiclePlate) {
      setPayVehiclePlate(defaultVehiclePlate);
    }
  }, [defaultVehiclePlate, payVehiclePlate]);

  useEffect(() => {
    if (!payPhone && data.profile.phone) {
      setPayPhone(data.profile.phone);
    }
  }, [data.profile.phone, payPhone]);

  const refresh = async () => {
    if (onApplicationCreated) {
      await onApplicationCreated();
    }
  };

  // Real-time polling while awaiting Safaricom callback
  useEffect(() => {
    if (
      !activeStkTx?.checkoutRequestId ||
      (stkStep !== "AWAITING_PIN" && stkStep !== "LAGGED")
    ) {
      return;
    }

    const startMs = Date.now();
    const timer = setInterval(async () => {
      const secs = Math.floor((Date.now() - startMs) / 1000);
      setElapsedSeconds(secs);

      try {
        const res = await fetchSaccoJson<{ transaction: SaccoTransaction }>(
          `/api/v1/mpesa/transactions/${encodeURIComponent(activeStkTx.checkoutRequestId)}`,
          {},
          effectiveToken,
        );
        const tx = res.transaction;
        setActiveStkTx(tx);

        if (tx.status === "SUCCESS" || tx.status === "RESOLVED_RECONCILED") {
          setStkStep("SUCCESS");
          setStkFlaggedLag(Boolean(tx.metadata?.flaggedDelayedCallback));
          setStkFeedback(
            `Payment captured by Safaricom (Receipt: ${tx.mpesaReceiptNumber}) and applied to your SACCO ${tx.transactionType === "LOAN_REPAYMENT" ? "loan balance" : "savings"} in real time!`,
          );
          clearInterval(timer);
          await refresh();
          return;
        }

        if (tx.status === "FAILED" || tx.status === "EXPIRED_UNPAID") {
          setStkStep("FAILED");
          setStkFeedback(
            tx.resultDescription ||
              "M-Pesa payment was cancelled or could not be completed.",
          );
          clearInterval(timer);
          await refresh();
          return;
        }

        // If Safaricom callback hasn't arrived after 6 seconds, flag lag state in UI
        if (secs >= 6 && stkStep === "AWAITING_PIN") {
          setStkStep("LAGGED");
          setStkFeedback(
            "Safaricom callback notification is taking longer than usual. Tap below to query the database & verify directly with Daraja.",
          );
        }
      } catch {
        // Ignore transient polling error
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [activeStkTx?.checkoutRequestId, stkStep, effectiveToken]);

  const openPayWithPurpose = (
    purpose: SaccoTransactionType,
    vehiclePlateOverride?: string,
  ) => {
    setPayPurpose(purpose);
    if (vehiclePlateOverride) {
      setPayVehiclePlate(vehiclePlateOverride);
    }
    setActiveTab("pay");
  };

  const submitMpesaPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    const numericAmount = Number(payAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setStkStep("FAILED");
      setStkFeedback("Enter a valid payment amount greater than KES 0.");
      return;
    }
    if (!payVehiclePlate.trim()) {
      setStkStep("FAILED");
      setStkFeedback("Please enter or select your vehicle registration number.");
      return;
    }
    if (!payPhone.trim()) {
      setStkStep("FAILED");
      setStkFeedback(
        "Please enter the M-Pesa phone number to receive the STK push.",
      );
      return;
    }

    setStkStep("SENDING");
    setStkFlaggedLag(false);
    setElapsedSeconds(0);
    setStkFeedback(
      "Connecting to Safaricom Daraja API and sending STK push to handset...",
    );

    try {
      const cleanPlate = payVehiclePlate.trim().toUpperCase();
      const response = await postSaccoJson<{
        success: boolean;
        message: string;
        checkoutRequestId: string;
        merchantRequestId: string;
        transaction: SaccoTransaction;
      }>(
        "/api/v1/mpesa/stk-push",
        {
          memberId: data.member.id,
          vehiclePlate: cleanPlate,
          transactionType: payPurpose,
          amount: numericAmount,
          phoneNumber: payPhone.trim(),
          accountReference: `${cleanPlate.replace(/\s+/g, "")}-${payPurpose === "LOAN_REPAYMENT" ? "LOAN" : "SAV"}`.slice(
            0,
            12,
          ),
          simulateLag,
        },
        effectiveToken,
      );

      setActiveStkTx(response.transaction);
      if (simulateLag) {
        setStkStep("LAGGED");
        setStkFeedback(
          "STK push sent with Callback Lag Simulation active. Safaricom callback is delayed — tap 'Query Database & Verify Safaricom Status' below to flag and reconcile.",
        );
      } else {
        setStkStep("AWAITING_PIN");
        setStkFeedback(
          `STK push sent to ${payPhone.trim()}. Enter your M-Pesa PIN on your phone — your ${payPurpose === "LOAN_REPAYMENT" ? "loan balance" : "savings"} will update automatically...`,
        );
      }
    } catch (error) {
      setStkStep("FAILED");
      setStkFeedback(
        error instanceof Error
          ? error.message
          : "Failed to initiate M-Pesa Daraja STK Push.",
      );
    }
  };

  const verifyDelayedStkTransaction = async (checkoutRequestId?: string) => {
    const targetCheckoutId = checkoutRequestId || activeStkTx?.checkoutRequestId;
    if (!targetCheckoutId) return;

    setStkStep("VERIFYING");
    setStkFeedback(
      "Querying SACCO database, flagging delayed Safaricom callback, and verifying payment status with Daraja API...",
    );

    try {
      const response = await postSaccoJson<{
        verified: boolean;
        flaggedDelayedCallback: boolean;
        message: string;
        transaction: SaccoTransaction;
      }>(
        `/api/v1/mpesa/transactions/${encodeURIComponent(targetCheckoutId)}/verify`,
        {
          reason:
            "Member triggered active database & Safaricom Daraja verification due to callback lag.",
        },
        effectiveToken,
      );

      setActiveStkTx(response.transaction);
      setStkFlaggedLag(Boolean(response.flaggedDelayedCallback));
      if (response.verified) {
        setStkStep("SUCCESS");
        setStkFeedback(response.message);
      } else {
        setStkStep("FAILED");
        setStkFeedback(response.message);
      }
      await refresh();
    } catch (error) {
      setStkStep("FAILED");
      setStkFeedback(
        error instanceof Error
          ? error.message
          : "Could not verify transaction status with Safaricom.",
      );
    }
  };

  const applyForLoan = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoanMessage("");
    try {
      await postSaccoJson(
        "/api/loans",
        {
          principalAmount: Number(amount),
          loanType,
          repaymentPeriodMonths: Number(repaymentPeriodMonths),
          repaymentMethod,
          incomeSource,
          monthlyIncome: monthlyIncome === "" ? null : Number(monthlyIncome),
          guarantorDetails,
          collateralDetails,
          notes,
        },
        effectiveToken,
      );
      setAmount("");
      setIncomeSource("");
      setMonthlyIncome("");
      setGuarantorDetails("");
      setCollateralDetails("");
      setNotes("");
      setShowLoanForm(false);
      setLoanMessage(
        "Application submitted! The Secretary will review eligibility first, then the Treasurer and Chairman.",
      );
      await refresh();
    } catch (error) {
      setLoanMessage(
        error instanceof Error
          ? error.message
          : "Application could not be submitted.",
      );
    }
  };

  const prepareReapplication = (loan: MemberLoanSummary) => {
    setAmount(String(loan.principalAmount));
    setLoanType(loan.loanType || "General");
    setRepaymentPeriodMonths(String(loan.repaymentPeriodMonths || 12));
    setRepaymentMethod(loan.repaymentMethod || "SACCO collection");
    setIncomeSource(loan.incomeSource || "");
    setMonthlyIncome(
      loan.monthlyIncome == null ? "" : String(loan.monthlyIncome),
    );
    setGuarantorDetails(loan.guarantorDetails || "");
    setCollateralDetails(loan.collateralDetails || "");
    setNotes(loan.notes || "");
    setShowLoanForm(true);
    setLoanMessage(
      "Rejected application details copied below. Update anything that changed and submit.",
    );
  };

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSettingsMessage("");
    try {
      await fetchSaccoJson(
        "/api/member-portal/profile",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: settingsEmail,
            profilePhotoData: profilePhotoData || null,
          }),
        },
        effectiveToken,
      );
      setSettingsMessage(
        "Your contact email and profile photo have been updated.",
      );
      await refresh();
    } catch (error) {
      setSettingsMessage(
        error instanceof Error
          ? error.message
          : "Profile could not be updated.",
      );
    }
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setSettingsMessage("");
    if (newPassword !== confirmPassword) {
      setSettingsMessage("The new password and confirmation do not match.");
      return;
    }
    try {
      await postSaccoJson(
        "/api/member-portal/change-password",
        { currentPassword, newPassword },
        effectiveToken,
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSettingsMessage("Your password has been changed.");
    } catch (error) {
      setSettingsMessage(
        error instanceof Error
          ? error.message
          : "Password could not be changed.",
      );
    }
  };

  const suspendOwnAccount = async () => {
    const reason = window.prompt(
      "Why are you leaving or suspending your SACCO membership? This reason is optional.",
    );
    if (reason === null) return;
    if (
      !window.confirm(
        "Suspend your member account? You will be signed out and a Secretary must reactivate it before you can return.",
      )
    )
      return;
    setSettingsMessage("");
    try {
      await postSaccoJson(
        "/api/member-portal/suspend",
        { reason },
        effectiveToken,
      );
      onAccountSuspended?.();
    } catch (error) {
      setSettingsMessage(
        error instanceof Error
          ? error.message
          : "Your account could not be suspended.",
      );
    }
  };

  const choosePhoto = (file?: File) => {
    setSettingsMessage("");
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 180 * 1024
    ) {
      setSettingsMessage(
        "Choose a PNG, JPEG, or WebP image that is 180 KB or smaller.",
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setProfilePhotoData(
        typeof reader.result === "string" ? reader.result : undefined,
      );
    reader.readAsDataURL(file);
  };

  const downloadStatement = () => {
    const lines = [
      "SACCO MEMBER STATEMENT",
      `Member: ${data.member.name}`,
      `Membership number: ${data.member.membershipNumber || "Not assigned"}`,
      "",
      "Date,Reference,Category,Type,Amount,Vehicle",
      ...data.transactions.map((transaction) =>
        [
          transaction.timestamp.slice(0, 10),
          transaction.refCode,
          transaction.category,
          transaction.type,
          transaction.amount,
          transaction.vehiclePlate || "",
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `member-statement-${data.member.membershipNumber || "account"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const downloadReceipt = (
    transaction: MemberPortalData["transactions"][number],
  ) => {
    const receipt = [
      "SOWETAMU SACCO — MEMBER TRANSACTION RECEIPT",
      "",
      `Receipt reference: ${transaction.refCode}`,
      `Date: ${transaction.timestamp.slice(0, 10)}`,
      `Member: ${data.profile.fullName}`,
      `Description: ${transaction.description}`,
      `Category: ${transaction.category}`,
      `Transaction: ${transaction.type}`,
      `Amount: ${formatKes(transaction.amount)}`,
      `Vehicle: ${transaction.vehiclePlate || "Not linked"}`,
    ].join("\n");
    const blob = new Blob([receipt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `receipt-${transaction.refCode || transaction.id}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const hasOpenLoan = data.loans.some((loan) => loanIsOpen(loan.status));
  const currentSavings = Number(data.member.savingsAmount || 0);
  const currentShares = Number(data.member.sharesAmount || 0);
  const currentLoanBalance = Number(data.member.loanBalance || 0);
  const enteredAmount = Math.max(0, Number(payAmount) || 0);
  const projectedSavings =
    payPurpose === "SAVINGS" ? currentSavings + enteredAmount : currentSavings;
  const projectedLoanBalance =
    payPurpose === "LOAN_REPAYMENT"
      ? Math.max(0, currentLoanBalance - enteredAmount)
      : currentLoanBalance;

  const displayBalance = (val: number) =>
    hideBalances ? "KES ••••••" : formatKes(val);

  const filteredTransactions = data.transactions.filter((tx) => {
    if (
      activityFilter === "SAVINGS" &&
      tx.category !== "Savings Contribution" &&
      !(Number(tx.savingsContribution || 0) > 0)
    ) {
      return false;
    }
    if (
      activityFilter === "LOANS" &&
      !(Number(tx.loanRepay || 0) > 0) &&
      !tx.description?.toLowerCase().includes("loan")
    ) {
      return false;
    }
    if (activitySearch.trim()) {
      const q = activitySearch.trim().toLowerCase();
      return (
        tx.refCode?.toLowerCase().includes(q) ||
        tx.description?.toLowerCase().includes(q) ||
        tx.vehiclePlate?.toLowerCase().includes(q) ||
        tx.category?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const saccoStkList = data.saccoTransactions || [];
  const pendingStkCount = saccoStkList.filter(
    (tx) => tx.status === "PENDING",
  ).length;

  return (
    <div
      className="min-h-dvh w-full bg-slate-900 sm:bg-gradient-to-br sm:from-slate-950 sm:via-emerald-950/90 sm:to-slate-900 flex flex-col items-center justify-center sm:py-4 sm:px-4 select-none"
      data-testid="member-mobile-app-shell"
    >
      {/* Desktop Top Floating Controls (Frame Toggle & Live Sync Indicator) */}
      <div className="hidden sm:flex items-center justify-between w-full max-w-[440px] mb-2.5 px-2 text-xs text-emerald-100/90">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="font-bold tracking-wide uppercase text-[11px]">
            Sowetamu M-Sacco Mobile App
          </span>
          <span className="rounded-full bg-emerald-500/20 border border-emerald-400/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
            Live Sync
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPhoneFrameMode((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/10 hover:bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white transition cursor-pointer"
          title="Toggle Phone Frame vs Full Width"
        >
          {phoneFrameMode ? (
            <>
              <Maximize2 className="h-3 w-3" /> Expand View
            </>
          ) : (
            <>
              <Minimize2 className="h-3 w-3" /> Phone Frame
            </>
          )}
        </button>
      </div>

      {/* Hidden File Input for Avatar Upload */}
      <input
        ref={photoInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => choosePhoto(event.target.files?.[0])}
      />

      {/* Mobile Device Container */}
      <div
        className={`w-full bg-slate-50 flex flex-col overflow-hidden relative transition-all duration-300 ${
          phoneFrameMode
            ? "h-dvh sm:h-[860px] sm:max-h-[90dvh] sm:max-w-[430px] sm:rounded-[44px] sm:border-[7px] sm:border-slate-800 sm:shadow-[0_25px_70px_-15px_rgba(0,0,0,0.75)]"
            : "h-dvh sm:h-[90dvh] sm:max-w-5xl sm:rounded-3xl sm:border sm:border-white/15 sm:shadow-2xl"
        }`}
      >
        {/* Mobile OS Status Bar + App Header (Dark Emerald FinTech Theme) */}
        <header className="bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-900 text-white shrink-0 z-20 shadow-md">
          {/* Simulated Mobile Status Bar on Desktop Phone Frame */}
          <div className="hidden sm:flex items-center justify-between px-6 pt-2.5 pb-1 text-[11px] font-semibold text-emerald-100/80">
            <span>9:41</span>
            <div className="h-4 w-24 rounded-full bg-black/50 border border-white/10 flex items-center justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mr-2" />
              <span className="h-1 w-8 rounded-full bg-white/20" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold">5G</span>
              <Wifi className="h-3 w-3" />
              <div className="w-5 h-2.5 rounded-xs border border-emerald-100/70 p-0.5 flex items-center">
                <div className="w-full h-full bg-emerald-400 rounded-[1px]" />
              </div>
            </div>
          </div>

          {/* Mobile App Top Bar: Profile + Notifications + Logout */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => photoInput.current?.click()}
                aria-label="Update profile photo"
                className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-emerald-400/50 bg-emerald-800 text-sm font-black text-white shadow-inner"
              >
                {profilePhotoData ? (
                  <img
                    src={profilePhotoData}
                    alt="Profile"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initials(data.profile.fullName)
                )}
                <span className="absolute -bottom-0.5 -right-0.5 rounded-tl-md bg-emerald-400 p-0.5 text-emerald-950">
                  <Camera className="h-2.5 w-2.5" />
                </span>
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
                    M-SACCO • {data.profile.membershipNumber}
                  </span>
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-400/20 px-1.5 py-0.2 text-[9px] font-bold text-emerald-200">
                    <BadgeCheck className="h-2.5 w-2.5 text-emerald-300" />
                    {data.member.status}
                  </span>
                </div>
                <h1 className="truncate text-base font-black tracking-tight text-white">
                  {data.profile.fullName}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setHideBalances((prev) => !prev)}
                className="rounded-xl bg-white/10 p-2 text-emerald-100 hover:bg-white/20 transition cursor-pointer"
                title={hideBalances ? "Show Balances" : "Hide Balances"}
                aria-label={hideBalances ? "Show Balances" : "Hide Balances"}
              >
                {hideBalances ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>

              {effectiveToken && (
                <div className="rounded-xl bg-white/10 text-white">
                  <NotificationCenter
                    token={effectiveToken}
                    onNavigate={() => setActiveTab("activity")}
                  />
                </div>
              )}

              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  data-testid="member-mobile-logout-btn"
                  className="rounded-xl bg-rose-500/20 border border-rose-400/30 p-2 text-rose-200 hover:bg-rose-500/30 transition cursor-pointer"
                  title="Sign Out"
                  aria-label="Sign Out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Persistent Live Ledger Strip (Always Mounted so Balances are Live on Every Tab) */}
          <div className="grid grid-cols-3 gap-1.5 px-3 pb-3 pt-1">
            <div className="rounded-2xl bg-white/10 backdrop-blur-xs border border-white/15 px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-200">
                Total Savings
              </p>
              <p
                className="mt-0.5 text-sm font-black text-white truncate"
                data-testid="member-savings-balance"
              >
                {displayBalance(currentSavings)}
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 backdrop-blur-xs border border-white/15 px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wider text-amber-200">
                Loan Balance
              </p>
              <p
                className="mt-0.5 text-sm font-black text-white truncate"
                data-testid="member-loan-balance"
              >
                {displayBalance(currentLoanBalance)}
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 backdrop-blur-xs border border-white/15 px-3 py-2">
              <p className="text-[9px] font-bold uppercase tracking-wider text-teal-200">
                Capital Shares
              </p>
              <p
                className="mt-0.5 text-sm font-black text-white truncate"
                data-testid="member-shares-balance"
              >
                {displayBalance(currentShares)}
              </p>
            </div>
          </div>
        </header>

        {/* Scrollable Mobile App Viewport */}
        <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-24">
          {/* Active STK Push Notification Banner if user switches away from Pay tab while STK is active */}
          {activeTab !== "pay" && stkStep !== "IDLE" && (
            <button
              type="button"
              onClick={() => setActiveTab("pay")}
              className={`w-full text-left rounded-2xl p-3.5 border flex items-center justify-between gap-3 shadow-xs transition cursor-pointer ${
                stkStep === "SUCCESS"
                  ? "bg-emerald-50 border-emerald-300 text-emerald-950"
                  : stkStep === "LAGGED"
                    ? "bg-amber-50 border-amber-300 text-amber-950"
                    : stkStep === "FAILED"
                      ? "bg-rose-50 border-rose-300 text-rose-950"
                      : "bg-teal-50 border-teal-300 text-teal-950"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Smartphone className="h-5 w-5 shrink-0 text-emerald-700" />
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-wider">
                    M-Pesa Express: {stkStep.replace("_", " ")}
                  </p>
                  <p className="text-xs truncate opacity-85">{stkFeedback}</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" />
            </button>
          )}

          {/* =========================================================
              TAB 1: HOME (Mobile Wallet, Quick Actions, Fleet, Feed)
             ========================================================= */}
          {activeTab === "home" && (
            <div className="space-y-4" data-testid="mobile-view-home">
              {/* Quick Actions Card (M-Pesa Super-App Style) */}
              <section className="rounded-3xl bg-white p-4 shadow-xs border border-slate-200/80">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                    Quick M-Sacco Actions
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    Daraja STK Ready
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <button
                    type="button"
                    onClick={() => openPayWithPurpose("SAVINGS")}
                    data-testid="quick-action-save-mpesa"
                    className="group flex flex-col items-center gap-1.5 rounded-2xl p-2 hover:bg-emerald-50 transition cursor-pointer"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md shadow-emerald-600/25 group-hover:scale-105 transition">
                      <ArrowUpRight className="h-6 w-6" />
                    </div>
                    <span className="text-[11px] font-bold text-slate-800 leading-tight">
                      Save M-Pesa
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openPayWithPurpose("LOAN_REPAYMENT")}
                    data-testid="quick-action-pay-loan"
                    className="group flex flex-col items-center gap-1.5 rounded-2xl p-2 hover:bg-teal-50 transition cursor-pointer"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-600 text-white shadow-md shadow-teal-600/25 group-hover:scale-105 transition">
                      <ArrowDownRight className="h-6 w-6" />
                    </div>
                    <span className="text-[11px] font-bold text-slate-800 leading-tight">
                      Pay Loan
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("loans");
                      setShowLoanForm(true);
                    }}
                    data-testid="quick-action-borrow"
                    className="group flex flex-col items-center gap-1.5 rounded-2xl p-2 hover:bg-amber-50 transition cursor-pointer"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-md shadow-amber-500/25 group-hover:scale-105 transition">
                      <Landmark className="h-5 w-5" />
                    </div>
                    <span className="text-[11px] font-bold text-slate-800 leading-tight">
                      Apply Loan
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={downloadStatement}
                    data-testid="quick-action-statement"
                    className="group flex flex-col items-center gap-1.5 rounded-2xl p-2 hover:bg-slate-100 transition cursor-pointer"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800 text-white shadow-md shadow-slate-800/20 group-hover:scale-105 transition">
                      <Download className="h-5 w-5" />
                    </div>
                    <span className="text-[11px] font-bold text-slate-800 leading-tight">
                      Statement
                    </span>
                  </button>
                </div>
              </section>

              {/* Embedded Express M-Pesa Promo Card */}
              <section className="rounded-3xl bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-600 p-4 text-white shadow-md flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider">
                    <Sparkles className="h-3 w-3" /> Instant STK Push
                  </div>
                  <h2 className="text-sm font-black">
                    Daily Remittance &amp; Loan Pay
                  </h2>
                  <p className="text-xs text-emerald-100 leading-snug">
                    Enter vehicle plate, choose Savings or Loan, and approve on
                    your phone.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("pay")}
                  className="shrink-0 rounded-2xl bg-white px-4 py-2.5 text-xs font-black text-emerald-900 shadow-sm hover:bg-emerald-50 transition cursor-pointer"
                >
                  Pay Now
                </button>
              </section>

              {/* My Matatu Fleet Card */}
              <section className="rounded-3xl bg-white p-4 shadow-xs border border-slate-200/80">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Bus className="h-4 w-4 text-emerald-600" />
                    <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
                      My Registered Vehicles ({data.vehicles.length})
                    </h2>
                  </div>
                </div>
                {data.vehicles.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2">
                    No vehicles currently linked to your member profile.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {data.vehicles.map((vehicle) => (
                      <div
                        key={vehicle.id}
                        className="rounded-2xl bg-slate-50 border border-slate-200/80 p-3 flex items-center justify-between gap-2"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-black text-slate-900">
                              {vehicle.plateNumber}
                            </span>
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                              {vehicle.status}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {vehicle.route || "Standard Route"} • Driver:{" "}
                            {vehicle.driverName || "Not assigned"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            openPayWithPurpose("SAVINGS", vehicle.plateNumber)
                          }
                          className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-[11px] font-black text-white transition shrink-0 cursor-pointer"
                        >
                          Pay STK
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Active Loan Mini-Card on Home */}
              {data.loans.length > 0 && (
                <section className="rounded-3xl bg-white p-4 shadow-xs border border-slate-200/80">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Landmark className="h-4 w-4 text-teal-600" />
                      <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
                        Active Loan Status
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("loans")}
                      className="text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
                    >
                      Manage
                    </button>
                  </div>
                  {data.loans.slice(0, 1).map((loan) => {
                    const total = loan.totalPayable || loan.principalAmount;
                    const paid = Number(loan.amountPaid || 0);
                    const pct =
                      total > 0
                        ? Math.min(100, Math.round((paid / total) * 100))
                        : 0;
                    return (
                      <div
                        key={loan.id}
                        className="rounded-2xl bg-slate-50 p-3 border border-slate-200/70 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-slate-900">
                            {loan.loanType || "General"} Loan ({loan.id})
                          </span>
                          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-800">
                            {loan.status}
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-600">
                          <span>
                            Paid:{" "}
                            <strong className="text-emerald-700">
                              {formatKes(paid)}
                            </strong>
                          </span>
                          <span>
                            Remaining:{" "}
                            <strong className="text-slate-900">
                              {formatKes(loan.outstandingBalance)}
                            </strong>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}

              {/* Recent Activity Feed on Home */}
              <section className="rounded-3xl bg-white p-4 shadow-xs border border-slate-200/80">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <ReceiptText className="h-4 w-4 text-emerald-600" />
                    <h2 className="text-xs font-black uppercase tracking-wider text-slate-800">
                      Recent Transactions
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("activity")}
                    className="text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
                  >
                    See All ({data.transactions.length})
                  </button>
                </div>

                {data.transactions.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    No transactions recorded yet.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {data.transactions.slice(0, 4).map((tx) => (
                      <div
                        key={tx.id}
                        className="py-2.5 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${
                              Number(tx.loanRepay || 0) > 0
                                ? "bg-teal-50 text-teal-700"
                                : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {Number(tx.loanRepay || 0) > 0 ? (
                              <ArrowDownRight className="h-4 w-4" />
                            ) : (
                              <ArrowUpRight className="h-4 w-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 truncate">
                              {tx.category}
                              {tx.vehiclePlate ? ` • ${tx.vehiclePlate}` : ""}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {tx.timestamp.slice(0, 10)} • Ref: {tx.refCode}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-black text-emerald-700">
                            {formatKes(tx.amount)}
                          </p>
                          <button
                            type="button"
                            onClick={() => downloadReceipt(tx)}
                            className="text-[10px] font-bold text-slate-400 hover:text-slate-700 cursor-pointer"
                          >
                            Receipt
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* =========================================================
              TAB 2: PAY (M-Pesa Express Daraja STK Push Form & Tracker)
             ========================================================= */}
          {activeTab === "pay" && (
            <div className="space-y-4" data-testid="mobile-view-pay">
              <section
                id="member-mpesa-payment-card"
                data-testid="member-mpesa-payment-card"
                className="rounded-3xl bg-white p-4 shadow-xs border border-emerald-200/80 space-y-4"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                      <Smartphone className="h-5 w-5" />
                    </div>
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                        Safaricom Daraja API
                      </span>
                      <h2 className="text-base font-black text-slate-900">
                        M-Pesa Express STK Pay
                      </h2>
                    </div>
                  </div>
                  <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[10px] font-black text-emerald-800">
                    Real-Time
                  </span>
                </div>

                <form onSubmit={submitMpesaPayment} className="space-y-4">
                  {/* Step 1: Vehicle Number */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="mpesa-vehicle-plate-input"
                        className="text-xs font-black uppercase tracking-wider text-slate-700"
                      >
                        1. Vehicle Number Plate
                      </label>
                      {data.vehicles.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {data.vehicles.map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => setPayVehiclePlate(v.plateNumber)}
                              className={`rounded-lg px-2 py-0.5 text-[10px] font-bold transition cursor-pointer ${
                                payVehiclePlate.toUpperCase() ===
                                v.plateNumber.toUpperCase()
                                  ? "bg-emerald-600 text-white"
                                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                              }`}
                            >
                              {v.plateNumber}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="relative">
                      <Bus className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="mpesa-vehicle-plate-input"
                        data-testid="mpesa-vehicle-plate-input"
                        type="text"
                        value={payVehiclePlate}
                        onChange={(e) =>
                          setPayVehiclePlate(e.target.value.toUpperCase())
                        }
                        placeholder="e.g. KDA 123A"
                        required
                        className="w-full rounded-2xl border border-slate-300 bg-slate-50 py-3 pl-10 pr-4 font-mono text-sm font-bold uppercase text-slate-900 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>
                  </div>

                  {/* Step 2: Payment Purpose (Savings vs Loan) */}
                  <div>
                    <span className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1.5">
                      2. Payment Destination
                    </span>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        data-testid="purpose-savings-btn"
                        onClick={() => setPayPurpose("SAVINGS")}
                        className={`flex flex-col items-start rounded-2xl border-2 p-3 text-left transition cursor-pointer ${
                          payPurpose === "SAVINGS"
                            ? "border-emerald-600 bg-emerald-50/80 shadow-xs"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white">
                            <ArrowUpRight className="h-4 w-4" />
                          </span>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-800">
                            + Add
                          </span>
                        </div>
                        <p className="mt-2 text-xs font-black text-slate-900">
                          Savings Deposit
                        </p>
                        <p className="text-[10px] text-slate-500">
                          Increases your SACCO savings
                        </p>
                      </button>

                      <button
                        type="button"
                        data-testid="purpose-loan-btn"
                        onClick={() => setPayPurpose("LOAN_REPAYMENT")}
                        className={`flex flex-col items-start rounded-2xl border-2 p-3 text-left transition cursor-pointer ${
                          payPurpose === "LOAN_REPAYMENT"
                            ? "border-teal-600 bg-teal-50/80 shadow-xs"
                            : "border-slate-200 bg-white hover:border-slate-300"
                        }`}
                      >
                        <div className="flex w-full items-center justify-between">
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-teal-600 text-white">
                            <ArrowDownRight className="h-4 w-4" />
                          </span>
                          <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-black uppercase text-teal-800">
                            - Deduct
                          </span>
                        </div>
                        <p className="mt-2 text-xs font-black text-slate-900">
                          Loan Repayment
                        </p>
                        <p className="text-[10px] text-slate-500">
                          Reduces your active loan
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* Step 3: Select or Enter Amount */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="mpesa-amount-input"
                        className="text-xs font-black uppercase tracking-wider text-slate-700"
                      >
                        3. Amount (KES)
                      </label>
                      <span className="text-[10px] font-semibold text-slate-400">
                        Tap a preset or type below
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 mb-2">
                      {presetAmounts.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          data-testid={`preset-amount-${preset}`}
                          onClick={() => setPayAmount(String(preset))}
                          className={`rounded-xl border py-2 text-xs font-black transition cursor-pointer ${
                            Number(payAmount) === preset
                              ? "border-emerald-600 bg-emerald-600 text-white shadow-xs"
                              : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          KES {preset.toLocaleString()}
                        </button>
                      ))}
                      {payPurpose === "LOAN_REPAYMENT" &&
                        currentLoanBalance > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setPayAmount(String(currentLoanBalance))
                            }
                            className="rounded-xl border border-amber-300 bg-amber-50 py-2 text-[11px] font-black text-amber-900 hover:bg-amber-100 transition cursor-pointer"
                          >
                            Clear ({formatKes(currentLoanBalance)})
                          </button>
                        )}
                    </div>
                    <div className="relative">
                      <CreditCard className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="mpesa-amount-input"
                        data-testid="mpesa-amount-input"
                        type="number"
                        min={1}
                        step="1"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        placeholder="Enter amount in KES"
                        required
                        className="w-full rounded-2xl border border-slate-300 bg-slate-50 py-3 pl-10 pr-4 text-base font-black text-slate-900 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>
                  </div>

                  {/* Step 4: M-Pesa Phone Number */}
                  <div>
                    <label
                      htmlFor="mpesa-phone-input"
                      className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1.5"
                    >
                      4. M-Pesa Phone Number (STK Prompt Target)
                    </label>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        id="mpesa-phone-input"
                        data-testid="mpesa-phone-input"
                        type="tel"
                        value={payPhone}
                        onChange={(e) => setPayPhone(e.target.value)}
                        placeholder="0722112233 or +254722112233"
                        required
                        className="w-full rounded-2xl border border-slate-300 bg-slate-50 py-3 pl-10 pr-4 text-sm font-bold text-slate-900 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>
                  </div>

                  {/* Live Balance Impact Preview */}
                  <div className="rounded-2xl bg-slate-900 p-3.5 text-white space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                      <span>Real-Time Balance Impact</span>
                      <span>
                        {payPurpose === "SAVINGS"
                          ? "+ Savings"
                          : "- Loan Balance"}
                      </span>
                    </div>
                    {payPurpose === "SAVINGS" ? (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300">
                          {formatKes(currentSavings)} +{" "}
                          {formatKes(enteredAmount)}
                        </span>
                        <span
                          className="text-sm font-black text-emerald-400"
                          data-testid="projected-savings-amount"
                        >
                          → {formatKes(projectedSavings)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-300">
                          {formatKes(currentLoanBalance)} -{" "}
                          {formatKes(enteredAmount)}
                        </span>
                        <span
                          className="text-sm font-black text-teal-300"
                          data-testid="projected-loan-amount"
                        >
                          → {formatKes(projectedLoanBalance)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Lag Simulation Toggle */}
                  <label
                    htmlFor="simulate-lag-checkbox"
                    className="flex cursor-pointer items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-950"
                  >
                    <input
                      id="simulate-lag-checkbox"
                      data-testid="simulate-lag-checkbox"
                      type="checkbox"
                      checked={simulateLag}
                      onChange={(e) => setSimulateLag(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-amber-400 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <span className="font-bold">
                        Simulate Safaricom Callback Lag / Missing Notification
                      </span>
                      <p className="mt-0.5 text-[11px] text-amber-800">
                        Holds automatic callback so you can test flagging &amp;
                        database/Daraja query reconciliation.
                      </p>
                    </div>
                  </label>

                  {/* Submit Pay Button */}
                  <button
                    type="submit"
                    data-testid="mpesa-pay-submit-btn"
                    disabled={
                      stkStep === "SENDING" || stkStep === "VERIFYING"
                    }
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-black text-white shadow-lg shadow-emerald-600/25 transition hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
                  >
                    {stkStep === "SENDING" ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Sending Daraja STK Push...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" />
                        Pay {formatKes(enteredAmount)} via M-Pesa
                      </>
                    )}
                  </button>
                </form>

                {/* Live 4-Stage STK Tracker & Callback Lag Verification Box */}
                {stkStep !== "IDLE" && (
                  <div
                    data-testid="stk-live-status-box"
                    className={`rounded-2xl border p-4 transition-all space-y-3 ${
                      stkStep === "SUCCESS"
                        ? "border-emerald-300 bg-emerald-50/90 text-emerald-950"
                        : stkStep === "LAGGED"
                          ? "border-amber-300 bg-amber-50/90 text-amber-950"
                          : stkStep === "FAILED"
                            ? "border-rose-300 bg-rose-50/90 text-rose-950"
                            : "border-teal-200 bg-teal-50/70 text-teal-950"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        {stkStep === "SUCCESS" ? (
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                        ) : stkStep === "LAGGED" ? (
                          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                        ) : stkStep === "FAILED" ? (
                          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                        ) : (
                          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-teal-700" />
                        )}
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h4
                              className="text-xs font-black uppercase tracking-wider"
                              data-testid="stk-status-heading"
                            >
                              {stkStep === "SENDING" &&
                                "1/4 Calling Daraja API"}
                              {stkStep === "AWAITING_PIN" &&
                                `2/4 Awaiting M-Pesa PIN (${elapsedSeconds}s)`}
                              {stkStep === "LAGGED" &&
                                "Callback Lag Flagged — Action Available"}
                              {stkStep === "VERIFYING" &&
                                "Querying Database & Daraja..."}
                              {stkStep === "SUCCESS" &&
                                "4/4 Payment Settled in SACCO"}
                              {stkStep === "FAILED" && "Payment Issue"}
                            </h4>
                            {stkFlaggedLag && (
                              <span
                                data-testid="lag-flagged-badge"
                                className="rounded-full bg-amber-200 px-2 py-0.5 text-[9px] font-black uppercase text-amber-950"
                              >
                                Lag Flagged &amp; Reconciled
                              </span>
                            )}
                          </div>
                          <p
                            className="mt-1 text-xs leading-relaxed"
                            data-testid="stk-feedback-message"
                          >
                            {stkFeedback}
                          </p>
                          {activeStkTx && (
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono">
                              <span className="rounded bg-white/80 px-2 py-0.5 border border-black/10">
                                ID: {activeStkTx.checkoutRequestId}
                              </span>
                              {activeStkTx.mpesaReceiptNumber && (
                                <span
                                  data-testid="stk-receipt-badge"
                                  className="rounded bg-emerald-600 px-2 py-0.5 font-bold text-white"
                                >
                                  Receipt: {activeStkTx.mpesaReceiptNumber}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {(stkStep === "AWAITING_PIN" || stkStep === "LAGGED") &&
                      activeStkTx?.checkoutRequestId && (
                        <button
                          type="button"
                          data-testid="verify-lagged-payment-btn"
                          onClick={() =>
                            verifyDelayedStkTransaction(
                              activeStkTx.checkoutRequestId,
                            )
                          }
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-3 py-2.5 text-xs font-black text-white shadow-xs hover:bg-amber-700 transition cursor-pointer"
                        >
                          <Database className="h-4 w-4" />
                          Query Database &amp; Verify Safaricom Status
                        </button>
                      )}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* =========================================================
              TAB 3: LOANS (Active Loan Progress + Mobile Application)
             ========================================================= */}
          {activeTab === "loans" && (
            <div className="space-y-4" data-testid="mobile-view-loans">
              <section className="rounded-3xl bg-white p-4 shadow-xs border border-slate-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-teal-700">
                      SACCO Credit Facility
                    </span>
                    <h2 className="text-base font-black text-slate-900">
                      My Loans &amp; Agreements
                    </h2>
                  </div>
                  {!hasOpenLoan && (
                    <button
                      type="button"
                      onClick={() => setShowLoanForm((prev) => !prev)}
                      className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white shadow-xs hover:bg-emerald-700 transition cursor-pointer"
                    >
                      <PlusCircle className="h-3.5 w-3.5" />
                      {showLoanForm ? "Hide Form" : "Apply Loan"}
                    </button>
                  )}
                </div>

                {loanMessage && (
                  <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-semibold text-emerald-900">
                    {loanMessage}
                  </div>
                )}

                {data.loans.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">
                    You have no active or past loan applications.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {data.loans.map((loan) => {
                      const total = loan.totalPayable || loan.principalAmount;
                      const paid = Number(loan.amountPaid || 0);
                      const pct =
                        total > 0
                          ? Math.min(
                              100,
                              Math.round((paid / total) * 100),
                            )
                          : 0;
                      const agreementReady = isLoanAgreementAvailable(
                        loan.status,
                      );

                      return (
                        <article
                          key={loan.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                                {loan.loanType || "General"} Loan • {loan.id}
                              </span>
                              <h3 className="text-base font-black text-slate-900">
                                {formatKes(loan.principalAmount)}
                              </h3>
                            </div>
                            <span className="rounded-full bg-white border border-slate-200 px-2.5 py-1 text-[10px] font-black text-slate-700">
                              {loan.status}
                            </span>
                          </div>

                          {/* Repayment Bar */}
                          <div className="space-y-1">
                            <div className="flex justify-between text-[11px] font-bold text-slate-600">
                              <span>Repayment Progress</span>
                              <span>{pct}% Paid</span>
                            </div>
                            <div className="w-full h-2.5 rounded-full bg-slate-200 overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-xl bg-white p-2.5 border border-slate-200/80">
                              <span className="text-[10px] text-slate-400 block">
                                Paid So Far
                              </span>
                              <strong
                                className="text-emerald-700 font-black"
                                data-testid="loan-paid-so-far"
                              >
                                {formatKes(paid)}
                              </strong>
                            </div>
                            <div className="rounded-xl bg-white p-2.5 border border-slate-200/80">
                              <span className="text-[10px] text-slate-400 block">
                                Outstanding
                              </span>
                              <strong
                                className="text-slate-900 font-black"
                                data-testid="loan-outstanding-amount"
                              >
                                {formatKes(loan.outstandingBalance)}
                              </strong>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 pt-1">
                            {loan.outstandingBalance > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  openPayWithPurpose("LOAN_REPAYMENT")
                                }
                                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-teal-600 px-3 py-2 text-xs font-black text-white hover:bg-teal-700 transition cursor-pointer"
                              >
                                <Smartphone className="h-3.5 w-3.5" />
                                Pay via M-Pesa
                              </button>
                            )}
                            {agreementReady && (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    printLoanAgreement(
                                      agreementFromMemberLoan(loan, data),
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                                >
                                  <Printer className="h-3.5 w-3.5" /> PDF
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    downloadLoanAgreementWord(
                                      agreementFromMemberLoan(loan, data),
                                    )
                                  }
                                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                                >
                                  <FileText className="h-3.5 w-3.5" /> Word
                                </button>
                              </>
                            )}
                            {loan.status === "Rejected" && !hasOpenLoan && (
                              <button
                                type="button"
                                onClick={() => prepareReapplication(loan)}
                                className="inline-flex items-center gap-1 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white cursor-pointer"
                              >
                                <RotateCcw className="h-3.5 w-3.5" /> Reapply
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Mobile Loan Application Wizard */}
              {(showLoanForm || !hasOpenLoan) && (
                <section
                  id="member-loan-application"
                  className="rounded-3xl bg-white p-4 shadow-xs border border-slate-200/80 space-y-3"
                >
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                      New Credit Request
                    </span>
                    <h3 className="text-sm font-black text-slate-900">
                      Apply for a SACCO Loan
                    </h3>
                  </div>

                  {hasOpenLoan ? (
                    <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                      You already have an active or pending loan application.
                      Clear your existing loan via M-Pesa to apply for a new
                      one.
                    </div>
                  ) : (
                    <form onSubmit={applyForLoan} className="space-y-3">
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Amount (KES)
                          </label>
                          <input
                            type="number"
                            min={1000}
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="50000"
                            required
                            className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-900"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Loan Type
                          </label>
                          <select
                            value={loanType}
                            onChange={(e) => setLoanType(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-900"
                          >
                            {loanTypes.map((item) => (
                              <option key={item} value={item}>
                                {item}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Period
                          </label>
                          <select
                            value={repaymentPeriodMonths}
                            onChange={(e) =>
                              setRepaymentPeriodMonths(e.target.value)
                            }
                            className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-900"
                          >
                            {repaymentPeriods.map((m) => (
                              <option key={m} value={m}>
                                {formatPeriod(m)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-slate-700 mb-1">
                            Repayment Mode
                          </label>
                          <select
                            value={repaymentMethod}
                            onChange={(e) => setRepaymentMethod(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-900"
                          >
                            {repaymentMethods.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <input
                          value={incomeSource}
                          onChange={(e) => setIncomeSource(e.target.value)}
                          placeholder="Income source (e.g. Matatu)"
                          required
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-900"
                        />
                        <input
                          type="number"
                          value={monthlyIncome}
                          onChange={(e) => setMonthlyIncome(e.target.value)}
                          placeholder="Monthly income (KES)"
                          required
                          className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-900"
                        />
                      </div>

                      <input
                        value={guarantorDetails}
                        onChange={(e) => setGuarantorDetails(e.target.value)}
                        placeholder="Guarantor name, member #, phone"
                        required
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-900"
                      />

                      <input
                        value={collateralDetails}
                        onChange={(e) => setCollateralDetails(e.target.value)}
                        placeholder="Collateral / security (e.g. Savings + Vehicle)"
                        required
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-900"
                      />

                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Loan purpose notes..."
                        rows={2}
                        required
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                      />

                      <button
                        type="submit"
                        className="w-full rounded-2xl bg-emerald-600 py-3 text-xs font-black text-white shadow-sm hover:bg-emerald-700 transition cursor-pointer"
                      >
                        Submit Loan Application
                      </button>
                    </form>
                  )}
                </section>
              )}
            </div>
          )}

          {/* =========================================================
              TAB 4: ACTIVITY (Ledger Statement, Receipts & STK Log)
             ========================================================= */}
          {activeTab === "activity" && (
            <div className="space-y-4" data-testid="mobile-view-activity">
              {/* Filter Pills & CSV Export */}
              <section className="rounded-3xl bg-white p-4 shadow-xs border border-slate-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-black text-slate-900">
                    Activity &amp; M-Pesa Log
                  </h2>
                  <button
                    type="button"
                    onClick={downloadStatement}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-800 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" /> CSV Statement
                  </button>
                </div>

                {/* Search Input */}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={activitySearch}
                    onChange={(e) => setActivitySearch(e.target.value)}
                    placeholder="Search receipt ref, vehicle plate..."
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-xs text-slate-900 outline-none focus:border-emerald-600 focus:bg-white"
                  />
                </div>

                {/* Filter Chips */}
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {(
                    [
                      { id: "ALL", label: "All Activity" },
                      { id: "SAVINGS", label: "Savings" },
                      { id: "LOANS", label: "Loans" },
                      {
                        id: "STK",
                        label: `M-Pesa STK (${saccoStkList.length})`,
                      },
                    ] as const
                  ).map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={() => setActivityFilter(chip.id)}
                      className={`rounded-xl px-3 py-1.5 text-[11px] font-black whitespace-nowrap transition cursor-pointer ${
                        activityFilter === chip.id
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* M-Pesa STK Requests Log (Shown when ALL or STK filter is active) */}
              {(activityFilter === "ALL" || activityFilter === "STK") &&
                saccoStkList.length > 0 && (
                  <section className="rounded-3xl bg-white p-4 shadow-xs border border-slate-200/80 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black uppercase tracking-wider text-emerald-700">
                        Daraja STK Push Requests
                      </span>
                      <span className="text-[10px] font-semibold text-slate-400">
                        Lag &amp; Callback Monitor
                      </span>
                    </div>
                    <div className="space-y-2">
                      {saccoStkList.slice(0, 8).map((mtx) => {
                        const mtxPlate = String(
                          mtx.metadata?.vehiclePlate ||
                            mtx.accountReference ||
                            "—",
                        );
                        return (
                          <div
                            key={mtx.id}
                            className="rounded-2xl border border-slate-200 bg-slate-50 p-3 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-xs font-black text-slate-900">
                                  {mtxPlate}
                                </span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${
                                    mtx.status === "SUCCESS" ||
                                    mtx.status === "RESOLVED_RECONCILED"
                                      ? "bg-emerald-100 text-emerald-800"
                                      : mtx.status === "PENDING"
                                        ? "bg-amber-100 text-amber-800"
                                        : "bg-rose-100 text-rose-800"
                                  }`}
                                >
                                  {mtx.status}
                                </span>
                                {Boolean(
                                  mtx.metadata?.flaggedDelayedCallback,
                                ) && (
                                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[9px] font-black text-amber-950">
                                    Flagged Lag
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-600 mt-0.5">
                                {mtx.transactionType === "LOAN_REPAYMENT"
                                  ? "Loan Repayment"
                                  : "Savings Deposit"}{" "}
                                •{" "}
                                {mtx.mpesaReceiptNumber
                                  ? `Receipt: ${mtx.mpesaReceiptNumber}`
                                  : "Awaiting Callback"}
                              </p>
                            </div>
                            <div className="text-right shrink-0 space-y-1">
                              <p className="text-xs font-black text-slate-900">
                                {formatKes(mtx.amount)}
                              </p>
                              {mtx.status === "PENDING" &&
                                mtx.checkoutRequestId && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      verifyDelayedStkTransaction(
                                        mtx.checkoutRequestId,
                                      )
                                    }
                                    className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2 py-1 text-[10px] font-black text-white hover:bg-amber-700 cursor-pointer"
                                  >
                                    <RefreshCw className="h-3 w-3" /> Flag &amp;
                                    Verify
                                  </button>
                                )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

              {/* Ledger Transactions List */}
              {activityFilter !== "STK" && (
                <section className="rounded-3xl bg-white p-4 shadow-xs border border-slate-200/80 space-y-2.5">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 block">
                    Posted SACCO Ledger Entries ({filteredTransactions.length})
                  </span>
                  {filteredTransactions.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">
                      No matching transactions found.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredTransactions.map((tx) => (
                        <div
                          key={tx.id}
                          className="py-3 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-slate-900">
                                {tx.category}
                              </span>
                              {tx.vehiclePlate && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700">
                                  {tx.vehiclePlate}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 truncate mt-0.5">
                              {tx.description}
                            </p>
                            <p className="text-[10px] font-mono text-slate-400">
                              {tx.timestamp.slice(0, 10)} • Ref: {tx.refCode}
                            </p>
                          </div>
                          <div className="text-right shrink-0 space-y-1">
                            <p className="text-xs font-black text-emerald-700">
                              {formatKes(tx.amount)}
                            </p>
                            <button
                              type="button"
                              onClick={() => downloadReceipt(tx)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                            >
                              <Download className="h-2.5 w-2.5" /> Receipt
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}

          {/* =========================================================
              TAB 5: PROFILE (Digital Member ID, Email, Password, Exit)
             ========================================================= */}
          {activeTab === "profile" && (
            <div className="space-y-4" data-testid="mobile-view-profile">
              {/* Digital Member ID Card */}
              <section className="rounded-3xl bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 p-4 text-white shadow-md space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-emerald-300">
                    Sowetamu Digital Member ID
                  </span>
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-14 w-14 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center text-lg font-black overflow-hidden">
                    {profilePhotoData ? (
                      <img
                        src={profilePhotoData}
                        alt="Member"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      initials(data.profile.fullName)
                    )}
                  </div>
                  <div>
                    <h2 className="text-base font-black">
                      {data.profile.fullName}
                    </h2>
                    <p className="text-xs text-emerald-200 font-mono">
                      Member #{data.profile.membershipNumber} • ID:{" "}
                      {data.profile.nationalId}
                    </p>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      Phone: {data.profile.phone}
                    </p>
                  </div>
                </div>
              </section>

              {settingsMessage && (
                <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-semibold text-emerald-900">
                  {settingsMessage}
                </div>
              )}

              {/* Contact Email & Photo Update */}
              <form
                onSubmit={saveProfile}
                className="rounded-3xl bg-white p-4 shadow-xs border border-slate-200/80 space-y-3"
              >
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-emerald-600" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                    Contact &amp; Avatar
                  </h3>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={settingsEmail}
                    onChange={(e) => setSettingsEmail(e.target.value)}
                    required
                    className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-900"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => photoInput.current?.click()}
                    className="flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    Upload Photo
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-xs font-black text-white hover:bg-emerald-700 cursor-pointer"
                  >
                    Save Profile
                  </button>
                </div>
              </form>

              {/* Change Password */}
              <form
                onSubmit={changePassword}
                className="rounded-3xl bg-white p-4 shadow-xs border border-slate-200/80 space-y-3"
              >
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-emerald-600" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                    Security &amp; PIN / Password
                  </h3>
                </div>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  required
                  className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-900"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-900"
                  />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-900"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-xl bg-slate-900 py-2.5 text-xs font-black text-white hover:bg-slate-800 cursor-pointer"
                >
                  Update Password
                </button>
              </form>

              {/* Account Actions */}
              <section className="rounded-3xl bg-white p-4 shadow-xs border border-rose-200/80 space-y-2.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-rose-600 block">
                  Account Controls
                </span>
                <div className="flex gap-2">
                  {onLogout && (
                    <button
                      type="button"
                      onClick={onLogout}
                      className="flex-1 rounded-xl bg-slate-900 py-2.5 text-xs font-black text-white hover:bg-slate-800 cursor-pointer"
                    >
                      Sign Out
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={suspendOwnAccount}
                    className="flex-1 rounded-xl border border-rose-300 bg-rose-50 py-2.5 text-xs font-bold text-rose-700 hover:bg-rose-100 cursor-pointer"
                  >
                    Pause Membership
                  </button>
                </div>
              </section>
            </div>
          )}
        </main>

        {/* =========================================================
            FIXED BOTTOM MOBILE NAVIGATION BAR (5 Tabs)
           ========================================================= */}
        <nav
          data-testid="mobile-bottom-nav"
          aria-label="Member mobile app navigation"
          className="absolute bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 py-1.5 flex items-center justify-around z-30 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]"
        >
          <button
            type="button"
            data-testid="mobile-tab-home"
            onClick={() => setActiveTab("home")}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-2xl transition cursor-pointer ${
              activeTab === "home"
                ? "text-emerald-700 font-black"
                : "text-slate-400 hover:text-slate-600 font-semibold"
            }`}
          >
            <Home
              className={`h-5 w-5 ${activeTab === "home" ? "stroke-[2.5]" : ""}`}
            />
            <span className="text-[10px] mt-0.5">Home</span>
          </button>

          <button
            type="button"
            data-testid="mobile-tab-pay"
            onClick={() => setActiveTab("pay")}
            className="flex flex-col items-center justify-center -mt-4 cursor-pointer group"
          >
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg transition ${
                activeTab === "pay"
                  ? "bg-emerald-600 text-white shadow-emerald-600/40 scale-105"
                  : "bg-slate-900 text-white shadow-slate-900/25 group-hover:bg-emerald-600"
              }`}
            >
              <Smartphone className="h-5 w-5" />
            </div>
            <span
              className={`text-[10px] mt-1 font-black ${
                activeTab === "pay" ? "text-emerald-700" : "text-slate-600"
              }`}
            >
              Pay M-Pesa
            </span>
          </button>

          <button
            type="button"
            data-testid="mobile-tab-loans"
            onClick={() => setActiveTab("loans")}
            className={`relative flex flex-col items-center justify-center py-1 px-3 rounded-2xl transition cursor-pointer ${
              activeTab === "loans"
                ? "text-emerald-700 font-black"
                : "text-slate-400 hover:text-slate-600 font-semibold"
            }`}
          >
            <Landmark
              className={`h-5 w-5 ${activeTab === "loans" ? "stroke-[2.5]" : ""}`}
            />
            <span className="text-[10px] mt-0.5">Loans</span>
            {hasOpenLoan && (
              <span className="absolute top-1 right-2.5 h-2 w-2 rounded-full bg-teal-500" />
            )}
          </button>

          <button
            type="button"
            data-testid="mobile-tab-activity"
            onClick={() => setActiveTab("activity")}
            className={`relative flex flex-col items-center justify-center py-1 px-3 rounded-2xl transition cursor-pointer ${
              activeTab === "activity"
                ? "text-emerald-700 font-black"
                : "text-slate-400 hover:text-slate-600 font-semibold"
            }`}
          >
            <History
              className={`h-5 w-5 ${activeTab === "activity" ? "stroke-[2.5]" : ""}`}
            />
            <span className="text-[10px] mt-0.5">Activity</span>
            {pendingStkCount > 0 && (
              <span className="absolute top-0.5 right-2 rounded-full bg-amber-500 px-1 text-[9px] font-black text-white">
                {pendingStkCount}
              </span>
            )}
          </button>

          <button
            type="button"
            data-testid="mobile-tab-profile"
            onClick={() => setActiveTab("profile")}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-2xl transition cursor-pointer ${
              activeTab === "profile"
                ? "text-emerald-700 font-black"
                : "text-slate-400 hover:text-slate-600 font-semibold"
            }`}
          >
            <UserRound
              className={`h-5 w-5 ${activeTab === "profile" ? "stroke-[2.5]" : ""}`}
            />
            <span className="text-[10px] mt-0.5">Profile</span>
          </button>
        </nav>
      </div>
    </div>
  );
}

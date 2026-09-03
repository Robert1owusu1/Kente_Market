// FILE LOCATION: src/components/legal/legalContent.js
// DESCRIPTION: Content (sections) for the Terms of Service and Privacy Policy.
//              Kept separate from presentation so it is easy to edit and reuse
//              in both the dedicated pages and the in-register agreement panel.

export const termsOfService = {
  title: "Terms of Service",
  type: "terms",
  updatedAt: "September 2, 2026",
  intro:
    "Welcome to Bonwire Kente. These Terms of Service ('Terms') govern your access to and use of our website, application, and services (collectively, the 'Service'). By creating an account, placing an order, or using any part of the Service, you agree to be bound by these Terms. Please read them carefully before creating an account.",
  sections: [
    {
      heading: "Acceptance of Terms",
      body: "By accessing or using the Service, you acknowledge that you have read, understood, and agree to be legally bound by these Terms and our Privacy Policy. If you do not agree, you must not create an account or use the Service.",
    },
    {
      heading: "Eligibility",
      body: "You must be at least 18 years old, or the legal age of majority in your jurisdiction, to create an account or make a purchase. By using the Service you represent that you meet these requirements and that the information you provide is accurate and complete.",
    },
    {
      heading: "Your Account & Responsibilities",
      body: [
        "You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account.",
        "You agree to provide true, accurate, and current information and to keep it up to date.",
        "You must notify us immediately of any unauthorized use of your account or any other breach of security.",
        "We may suspend or terminate your account if you violate these Terms.",
      ],
    },
    {
      heading: "Orders, Pricing & Payments",
      body: [
        { label: "Order Acceptance", text: "All orders are subject to availability and acceptance. We may decline or cancel an order at any time, including after an order is placed." },
        { label: "Pricing", text: "Prices are displayed in Ghanaian Cedi (GH₵) and are inclusive of applicable taxes unless otherwise stated. We reserve the right to change prices at any time." },
        { label: "Payment", text: "Payment is processed securely through third-party providers (such as Paystack and Mobile Money). By submitting payment you authorise the charge of the relevant amount." },
        { label: "Delivery", text: "Estimated delivery times are provided as guidance and are not guarantees. Risk of loss passes to you upon delivery." },
      ],
    },
    {
      heading: "Returns & Refunds",
      body: "We accept returns in accordance with our returns policy. To be eligible, items must be returned in their original condition within the stated return window. Refunds, where approved, will be issued to the original payment method after inspection.",
    },
    {
      heading: "Vendors & Marketplace",
      body: "Certain products are offered by independent vendors through our marketplace. We facilitate transactions between you and these vendors and may hold funds in escrow until delivery is confirmed. You agree that your purchase contract with a vendor is separate from our provision of the platform.",
    },
    {
      heading: "Intellectual Property",
      body: "All content, logos, designs, text, graphics, and software on the Service are the property of Bonwire Kente or its licensors and are protected by applicable intellectual property laws. You may not reproduce, distribute, or create derivative works without our prior written consent.",
    },
    {
      heading: "Prohibited Conduct",
      body: "You agree not to misuse the Service, including but not limited to: engaging in fraudulent activity, interfering with the Service's operation, transmitting malicious code, attempting to gain unauthorised access, or using the Service for any unlawful purpose.",
    },
    {
      heading: "Limitation of Liability",
      body: "To the maximum extent permitted by law, Bonwire Kente shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, arising from your use of the Service or any products purchased through it.",
    },
    {
      heading: "Termination",
      body: "We reserve the right to suspend or terminate your access to the Service, in whole or in part, at any time for any reason, including for violation of these Terms. You may stop using the Service and delete your account at any time.",
    },
    {
      heading: "Changes to These Terms",
      body: "We may update these Terms from time to time. When we do, we will revise the 'Last updated' date. Continued use of the Service after changes constitutes acceptance of the revised Terms.",
    },
    {
      heading: "Governing Law",
      body: "These Terms are governed by the laws of the Republic of Ghana, without regard to its conflict-of-law principles. Any disputes arising under these Terms shall be subject to the exclusive jurisdiction of the courts of Ghana.",
    },
    {
      heading: "Contact Us",
      body: "If you have any questions about these Terms, please contact us at kenterobert@gmail.com or at our registered address in Bonwire, Ashanti Region, Ghana.",
    },
  ],
};

export const privacyPolicy = {
  title: "Privacy Policy",
  type: "privacy",
  updatedAt: "September 2, 2026",
  intro:
    "This Privacy Policy explains how Bonwire Kente ('we', 'us') collects, uses, discloses, and safeguards your personal information when you use our website and services. Your privacy matters to us, and we are committed to protecting your data in accordance with applicable law.",
  sections: [
    {
      heading: "Information We Collect",
      body: [
        { label: "Account Information", text: "Name, email address, phone number, and password (stored securely) when you create an account." },
        { label: "Profile & Preferences", text: "Profile picture, saved favourites, and design preferences you choose to provide." },
        { label: "Transaction Information", text: "Order details, shipping address, payment method information, and order history." },
        { label: "Usage & Device Data", text: "IP address, browser type, device identifiers, pages visited, and referral sources." },
      ],
    },
    {
      heading: "How We Use Your Information",
      body: [
        "To create and manage your account and provide customer support.",
        "To process and fulfil orders, including payment processing and delivery.",
        "To verify your identity and secure your account (including email verification codes).",
        "To personalise your experience and improve our products and services.",
        "To send you order updates, service notifications, and (with your consent) marketing communications.",
        "To detect, prevent, and address fraud, security, or technical issues.",
      ],
    },
    {
      heading: "Email Verification & OTP",
      body: "As part of our security practices, we send one-time passcodes (OTPs) to your email address to verify that you own the account you are registering or accessing. These codes are used only for account security and expire shortly after issuance.",
    },
    {
      heading: "Legal Basis (GDPR / applicable law)",
      body: "Where the EU General Data Protection Regulation or similar law applies, we process personal data on the following bases: performance of a contract, compliance with legal obligations, our legitimate interests, and your consent (where required). You may withdraw consent at any time.",
    },
    {
      heading: "How We Share Your Information",
      body: [
        { label: "Service Providers", text: "We share data with trusted providers that help us operate the Service, such as payment processors (Paystack), email delivery services, and hosting providers." },
        { label: "Vendors & Delivery Partners", text: "We share order and shipping information with vendors and logistics partners to fulfil your purchases." },
        { label: "Legal Compliance", text: "We may disclose information where required by law or to protect our legal rights." },
      ],
    },
    {
      heading: "Cookies & Tracking",
      body: "We use cookies and similar technologies to keep you logged in, remember your preferences, and understand how the Service is used. You can control cookies through your browser settings, though some features may not function properly without them.",
    },
    {
      heading: "Data Security",
      body: "We implement appropriate technical and organisational measures to protect your personal information, including encryption of passwords and secure transmission of data. However, no method of transmission or storage is completely secure, and we cannot guarantee absolute security.",
    },
    {
      heading: "Data Retention",
      body: "We retain your personal information only for as long as necessary to fulfil the purposes described in this Policy, comply with legal obligations, resolve disputes, and enforce our agreements. Account data may be retained for a reasonable period after you request deletion where required by law.",
    },
    {
      heading: "Your Rights",
      body: [
        { label: "Access", text: "Request a copy of the personal data we hold about you." },
        { label: "Correction", text: "Request that we correct inaccurate or incomplete data." },
        { label: "Deletion", text: "Request deletion of your personal data, subject to legal obligations." },
        { label: "Restriction & Portability", text: "Request restriction of processing or that we provide your data in a portable format." },
        { label: "Objection", text: "Object to processing based on our legitimate interests or for marketing purposes." },
      ],
    },
    {
      heading: "Children's Privacy",
      body: "The Service is not intended for children under 13, and we do not knowingly collect personal information from them. If we learn that we have collected data from a child under 13, we will take steps to delete it.",
    },
    {
      heading: "Third-Party Links",
      body: "The Service may contain links to third-party websites or services. We are not responsible for the privacy practices of those third parties, and we encourage you to review their policies before providing them with your information.",
    },
    {
      heading: "Changes to This Policy",
      body: "We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy and revising the 'Last updated' date. Your continued use of the Service constitutes acceptance of the updated Policy.",
    },
    {
      heading: "Contact Us",
      body: "If you have questions or concerns about this Privacy Policy or your personal data, please contact us at kenterobert@gmail.com. We will respond to your request as promptly as possible.",
    },
  ],
};

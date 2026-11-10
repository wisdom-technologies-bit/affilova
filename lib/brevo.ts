interface BrevoEmailData {
  to: Array<{ email: string; name?: string }>
  subject: string
  htmlContent: string
  textContent?: string
  templateId?: number
  params?: Record<string, any>
}

export class BrevoService {
  private apiKey: string
  private baseUrl = "https://api.brevo.com/v3"
  private senderEmail = "affilova.team@gmail.com"
  private senderName = "Affilova"

  constructor() {
    this.apiKey = process.env.BREVO_API_KEY!
  }

  private getEmailTemplate(content: string): string {
    const currentYear = new Date().getFullYear()
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <div style="text-align: center; padding: 30px 20px; background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);">
          <img src="${process.env.NEXT_PUBLIC_APP_URL}/affilova-logo.png" alt="Affilova" style="height: 60px; filter: brightness(0) invert(1);">
        </div>
        <div style="padding: 30px 20px;">
          ${content}
        </div>
        <div style="background: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #e9ecef;">
          <p style="margin: 0; color: #6c757d; font-size: 14px;">
            © ${currentYear} Affilova. All rights reserved.
          </p>
          <p style="margin: 10px 0 0 0; color: #6c757d; font-size: 12px;">
            Powered by <strong>Wisdom Technologies®</strong>
          </p>
        </div>
      </div>
    `
  }

  async sendEmail(data: BrevoEmailData): Promise<{ messageId: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/smtp/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.apiKey,
        },
        body: JSON.stringify({
          sender: {
            name: this.senderName,
            email: this.senderEmail,
          },
          to: data.to,
          subject: data.subject,
          htmlContent: this.getEmailTemplate(data.htmlContent),
          textContent: data.textContent,
          templateId: data.templateId,
          params: data.params,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.message || "Failed to send email")
      }

      // Log email
      await this.logEmail({
        recipientEmail: data.to[0].email,
        emailType: "transactional",
        subject: data.subject,
        status: "sent",
        brevoMessageId: result.messageId,
      })

      return { messageId: result.messageId }
    } catch (error) {
      console.error("Brevo email error:", error)

      // Log failed email
      await this.logEmail({
        recipientEmail: data.to[0].email,
        emailType: "transactional",
        subject: data.subject,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      })

      throw error
    }
  }

  private async logEmail(logData: {
    recipientEmail: string
    emailType: string
    subject: string
    status: string
    brevoMessageId?: string
    errorMessage?: string
  }) {
    try {
      const { sql } = await import("@/lib/db")
      await sql`
        INSERT INTO email_logs (
          recipient_email, email_type, subject, status, 
          brevo_message_id, error_message
        )
        VALUES (
          ${logData.recipientEmail}, ${logData.emailType}, ${logData.subject},
          ${logData.status}, ${logData.brevoMessageId || null}, ${logData.errorMessage || null}
        )
      `
    } catch (error) {
      console.error("Failed to log email:", error)
    }
  }

  // Enhanced email templates
  async sendWelcomeEmail(userEmail: string, userName: string, role: string) {
    return this.sendEmail({
      to: [{ email: userEmail, name: userName }],
      subject: `Welcome to Affilova - Your ${role} Journey Begins!`,
      htmlContent: `
        <h1 style="color: #22c55e; margin-bottom: 20px;">Welcome to Affilova, ${userName}!</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Thank you for joining Affilova as a ${role}. We're excited to have you on board!</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Your account has been created successfully. You can now:</p>
        <ul style="font-size: 16px; line-height: 1.8; color: #374151; padding-left: 20px;">
          ${
            role === "vendor"
              ? "<li>List your products and start earning</li><li>Manage affiliate partnerships</li><li>Track your sales and analytics</li>"
              : "<li>Browse available products to promote</li><li>Apply to promote products</li><li>Track your commissions and earnings</li>"
          }
        </ul>
        <div style="text-align: center; margin: 40px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/${role}" 
             style="background: #22c55e; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
            Go to Dashboard
          </a>
        </div>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 30px 0;">
          <p style="margin: 0; font-size: 14px; color: #6b7280;">
            <strong>Need help?</strong> Our support team is here to assist you. Reply to this email or visit our help center.
          </p>
        </div>
      `,
    })
  }

  async sendLoginNotificationEmail(userEmail: string, userName: string, loginTime: string, ipAddress?: string) {
    return this.sendEmail({
      to: [{ email: userEmail, name: userName }],
      subject: "New Login to Your Affilova Account",
      htmlContent: `
        <h1 style="color: #22c55e; margin-bottom: 20px;">New Login Detected</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${userName},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">We detected a new login to your Affilova account:</p>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Time:</strong> ${loginTime}</p>
          ${ipAddress ? `<p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>IP Address:</strong> ${ipAddress}</p>` : ""}
        </div>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">If this wasn't you, please secure your account immediately by changing your password.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/profile/security" 
             style="background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
            Secure My Account
          </a>
        </div>
      `,
    })
  }

  async sendAccountDeletionEmail(userEmail: string, userName: string) {
    return this.sendEmail({
      to: [{ email: userEmail, name: userName }],
      subject: "Your Affilova Account Has Been Deleted",
      htmlContent: `
        <h1 style="color: #dc2626; margin-bottom: 20px;">Account Deletion Confirmation</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${userName},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Your Affilova account has been successfully deleted as requested.</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">All your data has been permanently removed from our systems. If you have any pending payments, they will be processed according to our terms.</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">We're sorry to see you go. If you change your mind, you're always welcome to create a new account.</p>
        <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #f59e0b;">
          <p style="margin: 0; font-size: 14px; color: #92400e;">
            <strong>Note:</strong> This action cannot be undone. If you believe this was done in error, please contact our support team immediately.
          </p>
        </div>
      `,
    })
  }

  async sendPaymentNotificationToAdmin(transactionData: {
    amount: number
    productTitle: string
    customerName: string
    vendorName: string
    affiliateName?: string
    transactionRef: string
  }) {
    return this.sendEmail({
      to: [{ email: "wisdommeremeze@gmail.com", name: "Admin" }],
      subject: `New Payment Received - ₦${(transactionData.amount / 100).toLocaleString()}`,
      htmlContent: `
        <h1 style="color: #22c55e; margin-bottom: 20px;">New Payment Received!</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">A new payment has been processed on Affilova:</p>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Product:</strong> ${transactionData.productTitle}</p>
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Amount:</strong> ₦${(transactionData.amount / 100).toLocaleString()}</p>
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Customer:</strong> ${transactionData.customerName}</p>
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Vendor:</strong> ${transactionData.vendorName}</p>
          ${transactionData.affiliateName ? `<p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Affiliate:</strong> ${transactionData.affiliateName}</p>` : ""}
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Transaction Ref:</strong> ${transactionData.transactionRef}</p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/admin/transactions" 
             style="background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
            View Transaction
          </a>
        </div>
      `,
    })
  }

  async sendProductListedEmail(vendorEmail: string, vendorName: string, productTitle: string) {
    return this.sendEmail({
      to: [{ email: vendorEmail, name: vendorName }],
      subject: `Product Listed Successfully - ${productTitle}`,
      htmlContent: `
        <h1 style="color: #22c55e; margin-bottom: 20px;">Product Listed Successfully!</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${vendorName},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Your product "<strong>${productTitle}</strong>" has been successfully listed on Affilova!</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Affiliates can now discover and apply to promote your product. You'll receive notifications when affiliates apply.</p>
        <div style="text-align: center; margin: 40px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/vendor" 
             style="background: #22c55e; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
            Manage Products
          </a>
        </div>
        <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #22c55e;">
          <p style="margin: 0; font-size: 14px; color: #065f46;">
            <strong>Pro Tip:</strong> Upload marketing resources for your affiliates to increase your product's appeal and conversion rates.
          </p>
        </div>
      `,
    })
  }

  async sendAffiliateApplicationEmail(
    vendorEmail: string,
    vendorName: string,
    affiliateName: string,
    productTitle: string,
  ) {
    return this.sendEmail({
      to: [{ email: vendorEmail, name: vendorName }],
      subject: `New Affiliate Application - ${productTitle}`,
      htmlContent: `
        <h1 style="color: #22c55e; margin-bottom: 20px;">New Affiliate Application</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${vendorName},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;"><strong>${affiliateName}</strong> has applied to promote your product "<strong>${productTitle}</strong>".</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Please review their application and approve or reject it from your dashboard.</p>
        <div style="text-align: center; margin: 40px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/vendor" 
             style="background: #22c55e; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
            Review Application
          </a>
        </div>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 30px 0;">
          <p style="margin: 0; font-size: 14px; color: #6b7280;">
            <strong>Quick Review:</strong> Check the affiliate's profile, experience level, and marketing channels before making your decision.
          </p>
        </div>
      `,
    })
  }

  async sendAffiliateApprovalEmail(
    affiliateEmail: string,
    affiliateName: string,
    productTitle: string,
    vendorName: string,
    approved: boolean,
  ) {
    const status = approved ? "Approved" : "Rejected"
    const color = approved ? "#22c55e" : "#dc2626"

    return this.sendEmail({
      to: [{ email: affiliateEmail, name: affiliateName }],
      subject: `Application ${status} - ${productTitle}`,
      htmlContent: `
        <h1 style="color: ${color}; margin-bottom: 20px;">Application ${status}</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${affiliateName},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">
          Your application to promote "<strong>${productTitle}</strong>" by ${vendorName} has been <strong>${status.toLowerCase()}</strong>.
        </p>
        ${
          approved
            ? `
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">You can now start promoting this product and earning commissions!</p>
          <div style="text-align: center; margin: 40px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/affiliate" 
               style="background: #22c55e; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
              Get Your Affiliate Link
            </a>
          </div>
        `
            : `
          <p style="font-size: 16px; line-height: 1.6; color: #374151;">Don't worry! There are many other products you can apply to promote.</p>
          <div style="text-align: center; margin: 40px 0;">
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/products" 
               style="background: #6b7280; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
              Browse Other Products
            </a>
          </div>
        `
        }
      `,
    })
  }

  async sendSaleNotificationEmail(
    recipientEmail: string,
    recipientName: string,
    isVendor: boolean,
    saleData: {
      productTitle: string
      amount: number
      customerName: string
      commission?: number
      affiliateName?: string
    },
  ) {
    const role = isVendor ? "vendor" : "affiliate"
    const earnings = isVendor ? saleData.amount - (saleData.commission || 0) : saleData.commission || 0

    return this.sendEmail({
      to: [{ email: recipientEmail, name: recipientName }],
      subject: `${isVendor ? "New Sale" : "Commission Earned"} - ${saleData.productTitle}`,
      htmlContent: `
        <h1 style="color: #22c55e; margin-bottom: 20px;">${isVendor ? "New Sale!" : "Commission Earned!"}</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${recipientName},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">
          ${isVendor ? "Great news! You've made a new sale:" : "Congratulations! You've earned a commission:"}
        </p>
        <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
          <p style="margin: 5px 0; font-size: 16px; color: #065f46;"><strong>Product:</strong> ${saleData.productTitle}</p>
          <p style="margin: 5px 0; font-size: 16px; color: #065f46;"><strong>Sale Amount:</strong> ₦${(saleData.amount / 100).toLocaleString()}</p>
          <p style="margin: 5px 0; font-size: 16px; color: #065f46;"><strong>Your ${isVendor ? "Earnings" : "Commission"}:</strong> ₦${(earnings / 100).toLocaleString()}</p>
          <p style="margin: 5px 0; font-size: 16px; color: #065f46;"><strong>Customer:</strong> ${saleData.customerName}</p>
          ${saleData.affiliateName && isVendor ? `<p style="margin: 5px 0; font-size: 16px; color: #065f46;"><strong>Affiliate:</strong> ${saleData.affiliateName}</p>` : ""}
        </div>
        <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #f59e0b;">
          <p style="margin: 0; font-size: 14px; color: #92400e;">
            <strong>Payment Schedule:</strong> Your ${isVendor ? "payout" : "commission"} will be processed on the next Thursday.
          </p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/${role}" 
             style="background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
            View Dashboard
          </a>
        </div>
      `,
    })
  }

  async sendWithdrawalRequestEmail(
    userEmail: string,
    userName: string,
    amount: number,
    status: "submitted" | "approved" | "rejected" | "completed",
  ) {
    const statusColors = {
      submitted: "#f59e0b",
      approved: "#22c55e",
      rejected: "#dc2626",
      completed: "#22c55e",
    }

    const statusMessages = {
      submitted: "Your withdrawal request has been submitted and is being reviewed.",
      approved: "Your withdrawal request has been approved and will be processed soon.",
      rejected: "Your withdrawal request has been rejected. Please contact support for more information.",
      completed: "Your withdrawal has been completed and the funds have been transferred to your account.",
    }

    return this.sendEmail({
      to: [{ email: userEmail, name: userName }],
      subject: `Withdrawal ${status.charAt(0).toUpperCase() + status.slice(1)} - ₦${(amount / 100).toLocaleString()}`,
      htmlContent: `
        <h1 style="color: ${statusColors[status]}; margin-bottom: 20px;">Withdrawal ${status.charAt(0).toUpperCase() + status.slice(1)}</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${userName},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">${statusMessages[status]}</p>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Amount:</strong> ₦${(amount / 100).toLocaleString()}</p>
          <p style="margin: 5px 0; font-size: 14px; color: #374151;"><strong>Status:</strong> ${status.charAt(0).toUpperCase() + status.slice(1)}</p>
        </div>
        ${
          status === "completed"
            ? `
          <div style="background: #ecfdf5; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #22c55e;">
            <p style="margin: 0; font-size: 14px; color: #065f46;">
              <strong>Note:</strong> Please allow 1-3 business days for the funds to reflect in your account.
            </p>
          </div>
        `
            : ""
        }
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" 
             style="background: #22c55e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
            View Dashboard
          </a>
        </div>
      `,
    })
  }

  async sendPasswordResetEmail(userEmail: string, userName: string, resetToken: string) {
    const resetUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password?token=${resetToken}`

    return this.sendEmail({
      to: [{ email: userEmail, name: userName }],
      subject: "Reset Your Affilova Password",
      htmlContent: `
        <h1 style="color: #22c55e; margin-bottom: 20px;">Reset Your Password</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${userName},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">We received a request to reset your password for your Affilova account.</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Click the button below to reset your password:</p>
        <div style="text-align: center; margin: 40px 0;">
          <a href="${resetUrl}" 
             style="background: #22c55e; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p style="font-size: 14px; line-height: 1.6; color: #6b7280;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="font-size: 14px; line-height: 1.6; color: #6b7280; word-break: break-all;">${resetUrl}</p>
        <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #f59e0b;">
          <p style="margin: 0; font-size: 14px; color: #92400e;">
            <strong>Security Note:</strong> This link will expire in 1 hour. If you didn't request this reset, please ignore this email.
          </p>
        </div>
      `,
    })
  }

  async sendPasswordResetConfirmationEmail(userEmail: string, userName: string) {
    return this.sendEmail({
      to: [{ email: userEmail, name: userName }],
      subject: "Password Reset Successful",
      htmlContent: `
        <h1 style="color: #22c55e; margin-bottom: 20px;">Password Reset Successful</h1>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Hi ${userName},</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">Your password has been successfully reset.</p>
        <p style="font-size: 16px; line-height: 1.6; color: #374151;">You can now sign in to your Affilova account with your new password.</p>
        <div style="text-align: center; margin: 40px 0;">
          <a href="${process.env.NEXT_PUBLIC_APP_URL}/auth/login" 
             style="background: #22c55e; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
            Sign In Now
          </a>
        </div>
        <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #f59e0b;">
          <p style="margin: 0; font-size: 14px; color: #92400e;">
            <strong>Security Tip:</strong> If you didn't reset your password, please contact our support team immediately.
          </p>
        </div>
      `,
    })
  }
}

export const brevoService = new BrevoService()

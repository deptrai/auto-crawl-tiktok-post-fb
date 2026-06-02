import { useState } from 'react'

interface EulaAcceptanceViewProps {
  accepting: boolean
  onAccept: () => Promise<void>
  onOpenPrivacyPolicy: () => Promise<void>
}

export function EulaAcceptanceView({
  accepting,
  onAccept,
  onOpenPrivacyPolicy
}: EulaAcceptanceViewProps): React.JSX.Element {
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAccept(): Promise<void> {
    setError(null)
    try {
      await onAccept()
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : 'Không thể lưu EULA')
    }
  }

  async function handlePrivacyClick(): Promise<void> {
    setError(null)
    try {
      await onOpenPrivacyPolicy()
    } catch (privacyError) {
      setError(privacyError instanceof Error ? privacyError.message : 'Không thể mở privacy policy')
    }
  }

  return (
    <main className="eula-card" aria-labelledby="eula-title">
      <p className="eyebrow">DRAFT - cần legal review</p>
      <h1 id="eula-title">Thỏa thuận người dùng</h1>
      <p className="lead">
        Trước khi dùng công cụ, bạn cần xác nhận đã hiểu rủi ro khi tự động hóa thao tác với
        Facebook và TikTok.
      </p>

      <section className="eula-copy" aria-label="Nội dung EULA">
        <p>
          Ứng dụng này hoạt động theo mô hình tool vendor: chúng tôi cung cấp phần mềm hỗ trợ vận
          hành, còn bạn là operator chịu trách nhiệm cấu hình, lựa chọn nội dung, tài khoản, proxy
          và cách sử dụng thực tế.
        </p>
        <p>
          Việc tự động đăng, crawl hoặc tương tác với Facebook/TikTok có thể vi phạm điều khoản dịch
          vụ của nền tảng, dẫn đến giới hạn tính năng, checkpoint, khóa tài khoản hoặc mất quyền
          truy cập dữ liệu. Bạn cần tự đánh giá và chỉ dùng công cụ trong phạm vi được phép.
        </p>
        <p>
          Telemetry bắt buộc chỉ được bật sau khi bạn accept EULA này. Story hiện tại chỉ lưu flag
          consent, chưa gửi beacon hoặc dữ liệu sử dụng ra ngoài.
        </p>
      </section>

      <button className="link-button" type="button" onClick={handlePrivacyClick}>
        Mở chính sách quyền riêng tư
      </button>

      <label className="consent-row">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => setAgreed(event.currentTarget.checked)}
        />
        <span>Tôi đồng ý với EULA và hiểu mình là operator chịu trách nhiệm sử dụng công cụ.</span>
      </label>

      {error ? <p className="error-message">{error}</p> : null}

      <button
        className="primary-button"
        type="button"
        disabled={!agreed || accepting}
        onClick={handleAccept}
      >
        {accepting ? 'Đang lưu...' : 'Chấp nhận và tiếp tục'}
      </button>
    </main>
  )
}

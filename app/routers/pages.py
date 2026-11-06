from pathlib import Path
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.templating import Jinja2Templates
from app.core.config import ROOT

router = APIRouter()
templates = Jinja2Templates(directory=str(ROOT / 'frontend/templates'))

PAGES = {
    'dang-nhap': 'auth/login.html', 'dang-ky': 'auth/register.html',
    'quen-mat-khau': 'auth/forgot.html', 'dat-lai-mat-khau': 'auth/reset.html',
    'doi-mat-khau': 'auth/change_password.html', 'ho-so': 'auth/profile.html',
    'xac-minh-email': 'auth/verify.html',
    'tim-kiem': 'movies/search.html',
}

LEGAL_PAGES = {
    'dieu-khoan': {
        'title': 'Điều Khoản Sử Dụng – PHE PHIM AI',
        'h1': 'Điều Khoản Sử Dụng',
        'eyebrow': 'ĐIỀU KHOẢN & PHÁP LÝ',
        'canonical': 'https://phephim.vercel.app/dieu-khoan/',
        'description': 'Quy định và điều khoản sử dụng dịch vụ trên nền tảng PHE PHIM AI.',
        'body': """
<h2>1. Chấp thuận các điều khoản</h2>
<p>Bằng việc truy cập hoặc sử dụng PHE PHIM AI, bạn đồng ý tuân thủ toàn bộ các điều khoản và điều kiện được nêu tại đây. Nếu không đồng ý với bất kỳ phần nào, vui lòng ngưng sử dụng dịch vụ.</p>
<h2>2. Quyền và trách nhiệm của người dùng</h2>
<p>Người dùng cam kết cung cấp thông tin chính xác khi đăng ký tài khoản, tự chịu trách nhiệm bảo mật thông tin đăng nhập và không sử dụng nền tảng cho bất kỳ mục đích vi phạm pháp luật nào.</p>
<h2>3. Quyền sở hữu trí tuệ</h2>
<p>Toàn bộ giao diện, thiết kế, mã nguồn, biểu tượng và nhãn hiệu thuộc quyền sở hữu của PHE PHIM AI hoặc các bên cấp phép hợp pháp. Người dùng không được sao chép, phân phối hoặc sửa đổi khi chưa có sự đồng ý bằng văn bản.</p>
<h2>4. Giới hạn trách nhiệm</h2>
<p>PHE PHIM AI nỗ lực duy trì dịch vụ hoạt động ổn định nhưng không chịu trách nhiệm đối với các sự cố gián đoạn phát sinh từ sự cố mạng viễn thông hoặc sự kiện bất khả kháng.</p>
        """
    },
    'chinh-sach-rieng-tu': {
        'title': 'Chính Sách Riêng Tư – PHE PHIM AI',
        'h1': 'Chính Sách Riêng Tư',
        'eyebrow': 'BẢO VỆ DỮ LIỆU',
        'canonical': 'https://phephim.vercel.app/chinh-sach-rieng-tu/',
        'description': 'Chính sách bảo mật thông tin và bảo vệ quyền riêng tư người dùng tại PHE PHIM AI.',
        'body': """
<h2>1. Thu thập thông tin</h2>
<p>Chúng tôi chỉ thu thập các thông tin tối thiểu cần thiết để phục vụ việc tạo tài khoản và trải nghiệm người dùng, bao gồm: tên hiển thị, địa chỉ email và dữ liệu phiên làm việc.</p>
<h2>2. Bảo mật mật khẩu & tài khoản</h2>
<p>Mật khẩu của người dùng được mã hóa một chiều bằng thuật toán Argon2id tiêu chuẩn an toàn cao trước khi lưu trữ. Không một nhân viên hoặc quản trị viên nào có thể xem mật khẩu gốc của bạn.</p>
<h2>3. Sử dụng Cookie</h2>
<p>Chúng tôi sử dụng cookie phiên an toàn (Secure, HttpOnly, SameSite) để duy trì trạng thái đăng nhập và ngăn chặn các cuộc tấn công CSRF.</p>
<h2>4. Cam kết không chia sẻ dữ liệu</h2>
<p>PHE PHIM AI cam kết không bán, chia sẻ hoặc tiết lộ thông tin cá nhân của người dùng cho bất kỳ bên thứ ba nào vì mục đích thương mại.</p>
        """
    },
    'lien-he': {
        'title': 'Liên Hệ Hỗ Trợ – PHE PHIM AI',
        'h1': 'Liên Hệ',
        'eyebrow': 'KÊNH HỖ TRỢ',
        'canonical': 'https://phephim.vercel.app/lien-he/',
        'description': 'Kênh liên hệ hỗ trợ, hợp tác và phản hồi kỹ thuật của PHE PHIM AI.',
        'body': """
<h2>1. Kênh tiếp nhận thông tin</h2>
<p>Mọi thắc mắc, đề xuất hợp tác hoặc yêu cầu hỗ trợ kỹ thuật xin vui lòng gửi về:</p>
<ul>
  <li><strong>Email hỗ trợ:</strong> contact@phephim.ai</li>
  <li><strong>Kênh cộng đồng:</strong> <a href="/cong-dong/">Ghé thăm diễn đàn cộng đồng</a></li>
  <li><strong>Thời gian phản hồi:</strong> Trong vòng 24–48 giờ làm việc.</li>
</ul>
<h2>2. Đóng góp ý kiến</h2>
<p>Chúng tôi luôn lắng nghe phản hồi của người dùng để cải thiện chất lượng dịch vụ và trải nghiệm điện ảnh.</p>
        """
    },
    'gioi-thieu': {
        'title': 'Giới Thiệu Về PHE PHIM AI – Điện Ảnh Dành Cho Bạn',
        'h1': 'Giới Thiệu',
        'eyebrow': 'VỀ CHÚNG TÔI',
        'canonical': 'https://phephim.vercel.app/gioi-thieu/',
        'description': 'Giới thiệu về PHE PHIM AI - nền tảng khám phá điện ảnh với trải nghiệm hình ảnh hiện đại.',
        'body': """
<h2>1. Sứ mệnh của PHE PHIM AI</h2>
<p>PHE PHIM AI ra đời với mục tiêu mang đến cho khán giả một không gian trải nghiệm điện ảnh trực quan, thẩm mỹ cao với hiệu năng tối ưu và giao diện điện ảnh đẳng cấp.</p>
<h2>2. Trải nghiệm công nghệ</h2>
<p>Hệ thống được phát triển theo kiến trúc hiện đại, hỗ trợ chuẩn phát trực tuyến phân giải cao, tối ưu hóa tốc độ tải trang và bảo mật tài khoản người dùng theo tiêu chuẩn an toàn cao.</p>
        """
    },
    'dmca': {
        'title': 'Chính Sách DMCA & Bản Quyền – PHE PHIM AI',
        'h1': 'DMCA & Báo Cáo Bản Quyền',
        'eyebrow': 'BẢN QUYỀN NỘI DUNG',
        'canonical': 'https://phephim.vercel.app/dmca/',
        'description': 'Quy trình tiếp nhận và xử lý khiếu nại bản quyền theo chuẩn DMCA tại PHE PHIM AI.',
        'body': """
<h2>1. Tôn trọng quyền sở hữu trí tuệ</h2>
<p>PHE PHIM AI tôn trọng quyền sở hữu trí tuệ của các tác giả, đạo diễn và đơn vị sản xuất nội dung. Chúng tôi luôn sẵn sàng tiếp nhận và xử lý các yêu cầu gỡ bỏ nội dung vi phạm bản quyền theo quy định của pháp luật và chuẩn DMCA.</p>
<h2>2. Quy trình gửi thông báo vi phạm</h2>
<p>Nếu bạn là chủ sở hữu quyền tác giả hoặc người đại diện hợp pháp và phát hiện nội dung có dấu hiệu vi phạm trên nền tảng, vui lòng gửi thông báo bao gồm:</p>
<ul>
  <li>Chữ ký điện tử hoặc chữ ký vật lý của người được ủy quyền.</li>
  <li>Mô tả tác phẩm được bảo hộ bản quyền bị nghi ngờ vi phạm.</li>
  <li>Đường dẫn URL chính xác đến nội dung cần gỡ bỏ trên PHE PHIM AI.</li>
  <li>Thông tin liên hệ của bạn (địa chỉ, số điện thoại, email).</li>
  <li>Cam kết rằng thông tin cung cấp là hoàn toàn chính xác.</li>
</ul>
<p>Email tiếp nhận khiếu nại bản quyền: <strong>copyright@phephim.ai</strong>. Chúng tôi sẽ rà soát và xử lý nội dung trong vòng 24 giờ sau khi xác minh tính hợp lệ.</p>
        """
    },
    'canh-bao-do-tuoi': {
        'title': 'Cảnh Báo Độ Tuổi & Xếp Loại Nội Dung – PHE PHIM AI',
        'h1': 'Cảnh Báo Độ Tuổi',
        'eyebrow': 'HƯỚNG DẪN NGƯỜI XEM',
        'canonical': 'https://phephim.vercel.app/canh-bao-do-tuoi/',
        'description': 'Hệ thống hướng dẫn phân loại độ tuổi và khuyến cáo nội dung người xem tại PHE PHIM AI.',
        'body': """
<h2>1. Phân loại nội dung</h2>
<p>Các tác phẩm điện ảnh trên PHE PHIM AI được gắn nhãn độ tuổi phù hợp theo tiêu chuẩn kiểm duyệt và khuyến cáo phổ biến:</p>
<ul>
  <li><strong>P (Mọi lứa tuổi):</strong> Nội dung phù hợp với mọi đối tượng khán giả, bao gồm trẻ nhỏ.</li>
  <li><strong>T13 (Từ 13 tuổi trở lên):</strong> Có thể chứa các tình huống hành động nhẹ hoặc ngôn ngữ kịch tính.</li>
  <li><strong>T16 (Từ 16 tuổi trở lên):</strong> Phim có yếu tố giật gân, hành động mạnh mẽ hoặc đề tài tâm lý phức tạp.</li>
  <li><strong>T18 (Từ 18 tuổi trở lên):</strong> Nội dung dành riêng cho người trưởng thành, có thể chứa yếu tố bạo lực hoặc cảnh nhạy cảm.</li>
</ul>
<h2>2. Trách nhiệm của phụ huynh và người giám hộ</h2>
<p>Phụ huynh và người giám hộ vui lòng lưu ý kiểm tra nhãn phân loại độ tuổi và hướng dẫn con em trước khi theo dõi các bộ phim có yếu tố cảnh báo.</p>
        """
    },
}

STATIC = ROOT / 'frontend/static'
ALIASES = {
    'app.js': 'js/movies/app.js', 'movie-api.js': 'js/movies/movie-api.js',
    'auth.js': 'js/auth/auth.js', 'auth-cinematic.js': 'js/auth/cinematic.js',
    'movies.css': 'css/movies.css', 'auth.css': 'css/auth.css',
    'auth-cinematic.css': 'css/auth-cinematic.css', 'hero_scrub.mp4': 'images/hero_scrub.mp4',
    'robots.txt': 'robots.txt', 'sitemap.xml': 'sitemap.xml',
}

@router.get('/robots.txt')
def robots():
    return safe_file('robots.txt')

@router.get('/sitemap.xml')
def sitemap():
    return safe_file('sitemap.xml')

@router.get('/')
def home(request: Request):
    return templates.TemplateResponse(request=request, name='home.html')

def render_legal(request: Request, key: str):
    info = LEGAL_PAGES.get(key)
    if not info:
        raise HTTPException(404)
    return templates.TemplateResponse(
        request=request,
        name='legal/page.html',
        context={
            'title': info['title'],
            'h1': info['h1'],
            'eyebrow': info.get('eyebrow', 'THÔNG TIN PHÁP LÝ'),
            'canonical': info['canonical'],
            'description': info['description'],
            'body': info['body'],
        }
    )

@router.get('/{page}/')
@router.get('/{page}/index.html')
def page(request: Request, page: str):
    if page in LEGAL_PAGES:
        return render_legal(request, page)
    name = PAGES.get(page)
    if name is None:
        raise HTTPException(404)
    return templates.TemplateResponse(request=request, name=name)

@router.api_route('/static/{path:path}', methods=['GET', 'HEAD'])
def static_file(path: str):
    return safe_file(path)

def safe_file(path: str):
    requested = Path(path)
    if any(part.startswith('.') for part in requested.parts):
        raise HTTPException(404)
    file = (STATIC / requested).resolve()
    if not file.is_relative_to(STATIC.resolve()) or not file.is_file():
        raise HTTPException(404)
    suffix = file.suffix.lower()
    if suffix not in {'.js','.css','.webp','.png','.mp4','.ico','.m3u8','.ts','.vtt','.mpd','.m4s','.txt','.xml'}:
        raise HTTPException(404)
    media_type = 'video/mp2t' if suffix == '.ts' else ('text/plain' if suffix == '.txt' else ('application/xml' if suffix == '.xml' else None))
    return FileResponse(file, media_type=media_type)

@router.get('/{name}')
def legacy_file(request: Request, name: str):
    if name == 'index.html':
        return templates.TemplateResponse(request=request, name='home.html')
    if name == 'robots.txt':
        return safe_file('robots.txt')
    if name == 'sitemap.xml':
        return safe_file('sitemap.xml')
    if name in LEGAL_PAGES:
        return render_legal(request, name)
    if name in PAGES:
        return templates.TemplateResponse(request=request, name=PAGES[name])
    path = ALIASES.get(name)
    if path is None:
        raise HTTPException(404)
    return safe_file(path)

@router.get('/{directory}/{path:path}')
def legacy_images(directory: str, path: str):
    if directory not in {'assets','frames','people','clips'}:
        raise HTTPException(404)
    return safe_file(f'images/{directory}/{path}')

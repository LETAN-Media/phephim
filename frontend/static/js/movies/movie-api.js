// Replace this adapter with a remote API while keeping the same movie shape.
const movies = [
 ['dune-part-two','Dune: Part Two',2024,'Mỹ','Khoa học viễn tưởng',8.1,'Phim lẻ','1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg','xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg'],
 ['oppenheimer','Oppenheimer',2023,'Mỹ','Chính kịch',8.1,'Phim lẻ','ptpr0kGAckfQkJeJIt8st5dglvd.jpg','fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg'],
 ['interstellar','Interstellar',2014,'Mỹ','Khoa học viễn tưởng',8.4,'Phim lẻ','gEU2QniE6E77NI6lCU6MxlNBvIx.jpg','xJHokMbljvjADYdit5fK5VQsXEG.jpg'],
 ['parasite','Parasite',2019,'Hàn Quốc','Giật gân',8.5,'Phim lẻ','7IiTTgloJzvGI1TAYymCfbfl3vT.jpg','TU9NIjwzjoKPwQHoHshkFcQUCG.jpg'],
 ['spirited-away','Spirited Away',2001,'Nhật Bản','Hoạt hình',8.5,'Phim lẻ','39wmItIWsg5sZMyRUHLkWBcuVCM.jpg','mSDsSDwaP3E7dEfUPWy4J0djcA5.jpg'],
 ['breaking-bad','Breaking Bad',2008,'Mỹ','Chính kịch',8.9,'5 mùa','ggFHVNu6YYI5L9pCfOacjizRGt.jpg','tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg'],
 ['the-last-of-us','The Last of Us',2023,'Mỹ','Phiêu lưu',8.6,'Phim bộ','uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg','9ijMGlJKqcslswWUzTEwScm82Gs.jpg']
].map(([slug,title,year,country,genre,rating,status,poster,backdrop])=>({slug,title,year,country,genre,rating,status,poster:`https://image.tmdb.org/t/p/w500/${poster}`,backdrop:`https://image.tmdb.org/t/p/w1280/${backdrop}`}));
export const movieApi = { async list(){return movies}, async get(slug){return movies.find(m=>m.slug===slug)} };

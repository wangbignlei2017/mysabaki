var mysql=require("mysql");
var pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'weiqi',
    port: 3306
});

var query=function(sql,ps,callback){
    pool.getConnection(function(err,conn){
        if(err){
            callback(err,null,null);
        }else{
            conn.query(sql,ps,function(qerr,vals,fields){
                //�ͷ�����
                conn.release();
                //�¼������ص�
                callback(qerr,vals,fields);
            });
        }
    });
};
module.exports=query;
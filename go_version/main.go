package main

import (
	"crypto/sha256"
	"embed"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/getlantern/systray"
)

// =============================================================
// 嵌入前端文件 + 托盘图标
// =============================================================

//go:embed static/*
var staticEmbed embed.FS

//go:embed icon.ico
var iconData []byte

// =============================================================
// 数据结构
// =============================================================

type Category struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type Item struct {
	ID          int     `json:"id"`
	CategoryID  int     `json:"categoryId"`
	Name        string  `json:"name"`
	Spec        string  `json:"spec"`
	Unit        string  `json:"unit"`
	UnitPrice   float64 `json:"unitPrice"`
	Quantity    float64 `json:"quantity"`
	MinQuantity float64 `json:"minQuantity"`
	Location    string  `json:"location"`
	Remark      string  `json:"remark"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
}

type Transaction struct {
	ID         int     `json:"id"`
	Type       string  `json:"type"`
	ItemID     int     `json:"itemId"`
	Quantity   float64 `json:"quantity"`
	UnitPrice  float64 `json:"unitPrice"`
	TotalPrice float64 `json:"totalPrice"`
	Operator   string  `json:"operator"`
	Remark     string  `json:"remark"`
	CreatedAt  string  `json:"createdAt"`
	UpdatedAt  string  `json:"updatedAt"`
}

type CheckRecord struct {
	ID        int    `json:"id"`
	CheckDate string `json:"checkDate"`
	Status    string `json:"status"`
	Items     string `json:"items"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type User struct {
	ID          int    `json:"id"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type Template struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Content   string `json:"content"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type Database struct {
	mu           sync.RWMutex
	Categories   []Category    `json:"categories"`
	Items        []Item        `json:"items"`
	Transactions []Transaction `json:"transactions"`
	Checks       []CheckRecord `json:"checks"`
	Users        []User        `json:"users"`
	Templates    []Template    `json:"templates"`
	nextID       map[string]int
}

type TokenEntry struct {
	UserID   int
	Username string
	Role     string
	Expires  time.Time
}

// =============================================================
// 全局状态
// =============================================================

var (
	db       *Database
	dbFile   string
	tokens   = make(map[string]TokenEntry)
	tmMu     sync.RWMutex
	localIP  = ""
	httpPort = 8765
)

const tokenExpiry = 24 * time.Hour

// =============================================================
// 数据库操作（JSON 文件存储）
// =============================================================

func NewDatabase() *Database {
	return &Database{
		nextID: map[string]int{
			"categories":   1,
			"items":        1,
			"transactions": 1,
			"checks":       1,
			"users":        1,
			"templates":    1,
		},
	}
}

func LoadOrCreateDB(path string) *Database {
	db := NewDatabase()
	data, err := os.ReadFile(path)
	if err == nil {
		json.Unmarshal(data, db)
		for _, c := range db.Categories {
			if c.ID >= db.nextID["categories"] {
				db.nextID["categories"] = c.ID + 1
			}
		}
		for _, c := range db.Items {
			if c.ID >= db.nextID["items"] {
				db.nextID["items"] = c.ID + 1
			}
		}
		for _, c := range db.Transactions {
			if c.ID >= db.nextID["transactions"] {
				db.nextID["transactions"] = c.ID + 1
			}
		}
		for _, c := range db.Checks {
			if c.ID >= db.nextID["checks"] {
				db.nextID["checks"] = c.ID + 1
			}
		}
		for _, c := range db.Users {
			if c.ID >= db.nextID["users"] {
				db.nextID["users"] = c.ID + 1
			}
		}
		for _, c := range db.Templates {
			if c.ID >= db.nextID["templates"] {
				db.nextID["templates"] = c.ID + 1
			}
		}
		log.Printf("已加载数据文件: %s", path)
	} else {
		log.Println("创建新数据文件")
	}

	if len(db.Users) == 0 {
		adminPwd := fmt.Sprintf("%x", sha256.Sum256([]byte("admin123")))
		db.Users = append(db.Users, User{
			ID: db.nextID["users"], Username: "admin", Password: adminPwd,
			DisplayName: "管理员", Role: "admin",
			CreatedAt: now(), UpdatedAt: now(),
		})
		db.nextID["users"]++
		db.Save(path)
		log.Println("已创建默认管理员 (admin / admin123)")
	}
	return db
}

func (d *Database) Save(path string) {
	data, _ := json.MarshalIndent(d, "", "  ")
	os.WriteFile(path, data, 0644)
}

func now() string {
	return time.Now().Format("2006-01-02T15:04:05.000Z07:00")
}

func hashPw(pw string) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(pw)))
}

// =============================================================
// HTTP 处理
// =============================================================

func getToken(r *http.Request) (TokenEntry, bool) {
	t := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	tmMu.RLock()
	entry, ok := tokens[t]
	tmMu.RUnlock()
	if !ok || time.Now().After(entry.Expires) {
		if ok {
			tmMu.Lock()
			delete(tokens, t)
			tmMu.Unlock()
		}
		return TokenEntry{}, false
	}
	return entry, true
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// =============================================================
// API 处理函数
// =============================================================

func handleAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method == "OPTIONS" {
		writeJSON(w, 200, nil)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api")
	path = strings.TrimSuffix(path, "/")

	if path == "/login" && r.Method == "POST" {
		handleLogin(w, r)
		return
	}

	_, ok := getToken(r)
	if !ok {
		writeJSON(w, 401, map[string]string{"error": "未登录或登录已过期"})
		return
	}

	switch {
	case path == "/stats/dashboard" && r.Method == "GET":
		handleStatsDashboard(w, r)
	case path == "/export" && r.Method == "GET":
		handleExport(w, r)
	case path == "/import" && r.Method == "POST":
		handleImport(w, r)
	case path == "/clear" && r.Method == "POST":
		handleClear(w, r)
	case path == "/users" && r.Method == "GET":
		handleList(w, r, "users")
	case path == "/users" && r.Method == "POST":
		handleCreate(w, r, "users", "username", "password")
	case path == "/users" && r.Method == "PUT":
		handleUpdate(w, r, "users")
	case path == "/users" && r.Method == "DELETE":
		handleDelete(w, r, "users")
	case path == "/categories" && r.Method == "GET":
		handleList(w, r, "categories")
	case path == "/categories" && r.Method == "POST":
		handleCreate(w, r, "categories", "name")
	case path == "/categories" && r.Method == "PUT":
		handleUpdate(w, r, "categories")
	case path == "/categories" && r.Method == "DELETE":
		handleDelete(w, r, "categories")
	case path == "/items" && r.Method == "GET":
		handleList(w, r, "items")
	case path == "/items" && r.Method == "POST":
		handleCreate(w, r, "items", "name")
	case path == "/items" && r.Method == "PUT":
		handleUpdate(w, r, "items")
	case path == "/items" && r.Method == "DELETE":
		handleDelete(w, r, "items")
	case path == "/transactions" && r.Method == "GET":
		handleList(w, r, "transactions")
	case path == "/transactions" && r.Method == "POST":
		handleCreate(w, r, "transactions", "type", "itemId")
	case path == "/transactions" && r.Method == "PUT":
		handleUpdate(w, r, "transactions")
	case path == "/checks" && r.Method == "GET":
		handleList(w, r, "checks")
	case path == "/checks" && r.Method == "POST":
		handleCreate(w, r, "checks")
	case path == "/checks" && r.Method == "PUT":
		handleUpdate(w, r, "checks")
	default:
		writeJSON(w, 404, map[string]string{"error": "接口不存在"})
	}
}

// =============================================================
// 登录
// =============================================================

func handleLogin(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	json.NewDecoder(r.Body).Decode(&body)
	username := body["username"]
	password := body["password"]

	db.mu.RLock()
	var user *User
	for i := range db.Users {
		if db.Users[i].Username == username {
			user = &db.Users[i]
			break
		}
	}
	db.mu.RUnlock()

	if user == nil || user.Password != hashPw(password) {
		writeJSON(w, 401, map[string]string{"error": "用户名或密码错误"})
		return
	}

	token := fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%s%d%d", username, user.ID, time.Now().UnixNano()))))
	tmMu.Lock()
	tokens[token] = TokenEntry{
		UserID: user.ID, Username: user.Username,
		Role: user.Role, Expires: time.Now().Add(tokenExpiry),
	}
	tmMu.Unlock()

	writeJSON(w, 200, map[string]interface{}{
		"token": token,
		"user": map[string]interface{}{
			"id": user.ID, "username": user.Username,
			"displayName": user.DisplayName, "role": user.Role,
		},
	})
}

// =============================================================
// CRUD 通用实现
// =============================================================

func handleList(w http.ResponseWriter, r *http.Request, table string) {
	db.mu.RLock()
	defer db.mu.RUnlock()

	var data interface{}
	switch table {
	case "categories":
		d := db.Categories
		if d == nil {
			d = []Category{}
		}
		data = d
	case "items":
		d := db.Items
		if d == nil {
			d = []Item{}
		}
		data = d
	case "transactions":
		d := db.Transactions
		if d == nil {
			d = []Transaction{}
		}
		data = d
	case "checks":
		d := db.Checks
		if d == nil {
			d = []CheckRecord{}
		}
		data = d
	case "users":
		d := db.Users
		if d == nil {
			d = []User{}
		}
		data = d
	case "templates":
		d := db.Templates
		if d == nil {
			d = []Template{}
		}
		data = d
	}
	writeJSON(w, 200, data)
}

func handleCreate(w http.ResponseWriter, r *http.Request, table string, required ...string) {
	var body map[string]interface{}
	json.NewDecoder(r.Body).Decode(&body)

	for _, field := range required {
		if _, ok := body[field]; !ok {
			writeJSON(w, 400, map[string]string{"error": fmt.Sprintf("缺少必填字段: %s", field)})
			return
		}
	}

	db.mu.Lock()
	defer db.mu.Unlock()

	n := now()
	if _, ok := body["createdAt"]; !ok {
		body["createdAt"] = n
	}
	if _, ok := body["updatedAt"]; !ok {
		body["updatedAt"] = n
	}

	switch table {
	case "categories":
		rec := Category{
			ID: db.nextID["categories"], Name: getStr(body, "name"),
			Description: getStr(body, "description"),
			CreatedAt: getStr(body, "createdAt"), UpdatedAt: getStr(body, "updatedAt"),
		}
		db.nextID["categories"]++
		db.Categories = append(db.Categories, rec)
		db.Save(dbFile)
		writeJSON(w, 201, rec)
	case "items":
		rec := Item{
			ID: db.nextID["items"], Name: getStr(body, "name"),
			CategoryID: getInt(body, "categoryId"), Spec: getStr(body, "spec"),
			Unit: getStr(body, "unit"), UnitPrice: getFloat(body, "unitPrice"),
			Quantity: getFloat(body, "quantity"), MinQuantity: getFloat(body, "minQuantity"),
			Location: getStr(body, "location"), Remark: getStr(body, "remark"),
			CreatedAt: getStr(body, "createdAt"), UpdatedAt: getStr(body, "updatedAt"),
		}
		db.nextID["items"]++
		db.Items = append(db.Items, rec)
		db.Save(dbFile)
		writeJSON(w, 201, rec)
	case "transactions":
		rec := Transaction{
			ID: db.nextID["transactions"], Type: getStr(body, "type"),
			ItemID: getInt(body, "itemId"), Quantity: getFloat(body, "quantity"),
			UnitPrice: getFloat(body, "unitPrice"), TotalPrice: getFloat(body, "totalPrice"),
			Operator: getStr(body, "operator"), Remark: getStr(body, "remark"),
			CreatedAt: getStr(body, "createdAt"), UpdatedAt: getStr(body, "updatedAt"),
		}
		db.nextID["transactions"]++
		db.Transactions = append(db.Transactions, rec)
		db.Save(dbFile)
		writeJSON(w, 201, rec)
	case "checks":
		rec := CheckRecord{
			ID: db.nextID["checks"], CheckDate: getStr(body, "checkDate"),
			Status: getStr(body, "status"), Items: getStr(body, "items"),
			CreatedAt: getStr(body, "createdAt"), UpdatedAt: getStr(body, "updatedAt"),
		}
		db.nextID["checks"]++
		db.Checks = append(db.Checks, rec)
		db.Save(dbFile)
		writeJSON(w, 201, rec)
	case "users":
		rec := User{
			ID: db.nextID["users"], Username: getStr(body, "username"),
			Password: hashPw(getStr(body, "password")),
			DisplayName: getStr(body, "displayName"), Role: getStr(body, "role"),
			CreatedAt: getStr(body, "createdAt"), UpdatedAt: getStr(body, "updatedAt"),
		}
		for _, u := range db.Users {
			if u.Username == rec.Username {
				writeJSON(w, 400, map[string]string{"error": "用户名已存在"})
				return
			}
		}
		db.nextID["users"]++
		db.Users = append(db.Users, rec)
		db.Save(dbFile)
		writeJSON(w, 201, rec)
	case "templates":
		rec := Template{
			ID: db.nextID["templates"], Name: getStr(body, "name"),
			Content: getStr(body, "content"),
			CreatedAt: getStr(body, "createdAt"), UpdatedAt: getStr(body, "updatedAt"),
		}
		db.nextID["templates"]++
		db.Templates = append(db.Templates, rec)
		db.Save(dbFile)
		writeJSON(w, 201, rec)
	}
}

func handleUpdate(w http.ResponseWriter, r *http.Request, table string) {
	var body map[string]interface{}
	json.NewDecoder(r.Body).Decode(&body)
	id := int(getFloat(body, "id"))
	if id == 0 {
		writeJSON(w, 400, map[string]string{"error": "缺少 id"})
		return
	}

	db.mu.Lock()
	defer db.mu.Unlock()

	body["updatedAt"] = now()

	switch table {
	case "categories":
		for i := range db.Categories {
			if db.Categories[i].ID == id {
				if v, ok := body["name"]; ok {
					db.Categories[i].Name = toStr(v)
				}
				if v, ok := body["description"]; ok {
					db.Categories[i].Description = toStr(v)
				}
				db.Categories[i].UpdatedAt = toStr(body["updatedAt"])
				db.Save(dbFile)
				writeJSON(w, 200, db.Categories[i])
				return
			}
		}
	case "items":
		for i := range db.Items {
			if db.Items[i].ID == id {
				if v, ok := body["name"]; ok {
					db.Items[i].Name = toStr(v)
				}
				if v, ok := body["spec"]; ok {
					db.Items[i].Spec = toStr(v)
				}
				if v, ok := body["categoryId"]; ok {
					db.Items[i].CategoryID = int(toFloat(v))
				}
				if v, ok := body["unit"]; ok {
					db.Items[i].Unit = toStr(v)
				}
				if v, ok := body["unitPrice"]; ok {
					db.Items[i].UnitPrice = toFloat(v)
				}
				if v, ok := body["quantity"]; ok {
					db.Items[i].Quantity = toFloat(v)
				}
				if v, ok := body["minQuantity"]; ok {
					db.Items[i].MinQuantity = toFloat(v)
				}
				if v, ok := body["location"]; ok {
					db.Items[i].Location = toStr(v)
				}
				if v, ok := body["remark"]; ok {
					db.Items[i].Remark = toStr(v)
				}
				db.Items[i].UpdatedAt = toStr(body["updatedAt"])
				db.Save(dbFile)
				writeJSON(w, 200, db.Items[i])
				return
			}
		}
	case "transactions":
		for i := range db.Transactions {
			if db.Transactions[i].ID == id {
				if v, ok := body["operator"]; ok {
					db.Transactions[i].Operator = toStr(v)
				}
				if v, ok := body["remark"]; ok {
					db.Transactions[i].Remark = toStr(v)
				}
				db.Transactions[i].UpdatedAt = toStr(body["updatedAt"])
				db.Save(dbFile)
				writeJSON(w, 200, db.Transactions[i])
				return
			}
		}
	case "users":
		for i := range db.Users {
			if db.Users[i].ID == id {
				if v, ok := body["username"]; ok {
					for j, u := range db.Users {
						if j != i && u.Username == toStr(v) {
							writeJSON(w, 400, map[string]string{"error": "用户名已存在"})
							return
						}
					}
					db.Users[i].Username = toStr(v)
				}
				if v, ok := body["password"]; ok {
					db.Users[i].Password = hashPw(toStr(v))
				}
				if v, ok := body["displayName"]; ok {
					db.Users[i].DisplayName = toStr(v)
				}
				if v, ok := body["role"]; ok {
					db.Users[i].Role = toStr(v)
				}
				db.Users[i].UpdatedAt = toStr(body["updatedAt"])
				db.Save(dbFile)
				writeJSON(w, 200, db.Users[i])
				return
			}
		}
	case "checks":
		for i := range db.Checks {
			if db.Checks[i].ID == id {
				if v, ok := body["status"]; ok {
					db.Checks[i].Status = toStr(v)
				}
				if v, ok := body["items"]; ok {
					db.Checks[i].Items = toStr(v)
				}
				db.Checks[i].UpdatedAt = toStr(body["updatedAt"])
				db.Save(dbFile)
				writeJSON(w, 200, db.Checks[i])
				return
			}
		}
	}
	writeJSON(w, 404, map[string]string{"error": "未找到"})
}

func handleDelete(w http.ResponseWriter, r *http.Request, table string) {
	idStr := r.URL.Query().Get("id")
	id, _ := strconv.Atoi(idStr)
	if id == 0 {
		writeJSON(w, 400, map[string]string{"error": "缺少 id 参数"})
		return
	}

	db.mu.Lock()
	defer db.mu.Unlock()

	switch table {
	case "categories":
		for i := range db.Categories {
			if db.Categories[i].ID == id {
				db.Categories = append(db.Categories[:i], db.Categories[i+1:]...)
				db.Save(dbFile)
				writeJSON(w, 200, map[string]bool{"success": true})
				return
			}
		}
	case "items":
		for i := range db.Items {
			if db.Items[i].ID == id {
				db.Items = append(db.Items[:i], db.Items[i+1:]...)
				db.Save(dbFile)
				writeJSON(w, 200, map[string]bool{"success": true})
				return
			}
		}
	case "transactions":
		for i := range db.Transactions {
			if db.Transactions[i].ID == id {
				db.Transactions = append(db.Transactions[:i], db.Transactions[i+1:]...)
				db.Save(dbFile)
				writeJSON(w, 200, map[string]bool{"success": true})
				return
			}
		}
	case "checks":
		for i := range db.Checks {
			if db.Checks[i].ID == id {
				db.Checks = append(db.Checks[:i], db.Checks[i+1:]...)
				db.Save(dbFile)
				writeJSON(w, 200, map[string]bool{"success": true})
				return
			}
		}
	case "users":
		for i := range db.Users {
			if db.Users[i].ID == id {
				if db.Users[i].Username == "admin" {
					writeJSON(w, 400, map[string]string{"error": "不能删除 admin 账号"})
					return
				}
				db.Users = append(db.Users[:i], db.Users[i+1:]...)
				db.Save(dbFile)
				writeJSON(w, 200, map[string]bool{"success": true})
				return
			}
		}
	}
	writeJSON(w, 404, map[string]string{"error": "未找到"})
}

// =============================================================
// 特殊接口
// =============================================================

func handleStatsDashboard(w http.ResponseWriter, r *http.Request) {
	db.mu.RLock()
	defer db.mu.RUnlock()

	totalItems := len(db.Items)
	var totalQty, totalValue float64
	for _, i := range db.Items {
		totalQty += i.Quantity
		totalValue += i.Quantity * i.UnitPrice
	}

	var lowStock []Item
	for _, i := range db.Items {
		if i.Quantity <= i.MinQuantity {
			lowStock = append(lowStock, i)
		}
	}

	today := time.Now().Format("2006-01-02")
	todayTxns := 0
	for _, t := range db.Transactions {
		if len(t.CreatedAt) >= 10 && t.CreatedAt[:10] == today {
			todayTxns++
		}
	}

	recent := make([]Transaction, len(db.Transactions))
	copy(recent, db.Transactions)
	sort.Slice(recent, func(i, j int) bool {
		return recent[i].CreatedAt > recent[j].CreatedAt
	})
	if len(recent) > 10 {
		recent = recent[:10]
	}

	writeJSON(w, 200, map[string]interface{}{
		"totalItems": totalItems,
		"totalQty":   totalQty,
		"totalValue": totalValue,
		"lowStock":   lowStock,
		"todayTxns":  todayTxns,
		"recentTxns": recent,
	})
}

func handleExport(w http.ResponseWriter, r *http.Request) {
	_ = r
	db.mu.RLock()
	data := map[string]interface{}{
		"categories":   db.Categories,
		"items":        db.Items,
		"transactions": db.Transactions,
		"checks":       db.Checks,
		"users":        db.Users,
		"templates":    db.Templates,
	}
	db.mu.RUnlock()
	writeJSON(w, 200, data)
}

func handleImport(w http.ResponseWriter, r *http.Request) {
	var raw map[string]json.RawMessage
	json.NewDecoder(r.Body).Decode(&raw)

	db.mu.Lock()
	defer db.mu.Unlock()

	if data, ok := raw["categories"]; ok && len(data) > 0 {
		var arr []Category
		json.Unmarshal(data, &arr)
		db.Categories = arr
	}
	if data, ok := raw["items"]; ok && len(data) > 0 {
		var arr []Item
		json.Unmarshal(data, &arr)
		db.Items = arr
	}
	if data, ok := raw["transactions"]; ok && len(data) > 0 {
		var arr []Transaction
		json.Unmarshal(data, &arr)
		db.Transactions = arr
	}
	if data, ok := raw["checks"]; ok && len(data) > 0 {
		var arr []CheckRecord
		json.Unmarshal(data, &arr)
		db.Checks = arr
	}
	if data, ok := raw["users"]; ok && len(data) > 0 {
		var arr []User
		json.Unmarshal(data, &arr)
		db.Users = arr
	}
	if data, ok := raw["templates"]; ok && len(data) > 0 {
		var arr []Template
		json.Unmarshal(data, &arr)
		db.Templates = arr
	}

	db.Save(dbFile)
	writeJSON(w, 200, map[string]bool{"success": true})
}

func handleClear(w http.ResponseWriter, r *http.Request) {
	db.mu.Lock()
	db.Categories = []Category{}
	db.Items = []Item{}
	db.Transactions = []Transaction{}
	db.Checks = []CheckRecord{}
	db.Users = []User{}
	db.Templates = []Template{}
	db.nextID = map[string]int{
		"categories": 1, "items": 1, "transactions": 1,
		"checks": 1, "users": 1, "templates": 1,
	}
	db.Save(dbFile)
	db.mu.Unlock()
	writeJSON(w, 200, map[string]bool{"success": true})
}

// =============================================================
// 工具函数
// =============================================================

func getStr(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func getInt(m map[string]interface{}, key string) int {
	return int(getFloat(m, key))
}

func getFloat(m map[string]interface{}, key string) float64 {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			return n
		case int:
			return float64(n)
		case string:
			f, _ := strconv.ParseFloat(n, 64)
			return f
		}
	}
	return 0
}

func toStr(v interface{}) string {
	switch s := v.(type) {
	case string:
		return s
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

func toFloat(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case string:
		f, _ := strconv.ParseFloat(n, 64)
		return f
	}
	return 0
}

// =============================================================
// 辅助功能：打开浏览器、获取本机IP、注册开机自启
// =============================================================

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Start()
}

func getLocalIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, a := range addrs {
		if ipnet, ok := a.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			return ipnet.IP.String()
		}
	}
	return ""
}

// Windows 开机自启：在注册表 HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run 添加
func registerAutoStart() {
	if runtime.GOOS != "windows" {
		return
	}
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	// 用 reg add 命令注册
	key := `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
	cmd := exec.Command("reg", "add", key, "/v", "StockSystem", "/t", "REG_SZ", "/d", exePath, "/f")
	cmd.Run()
	log.Println("已注册开机自启")
}

// =============================================================
// 系统托盘
// =============================================================

func onReady() {
	// 设置托盘图标
	if len(iconData) > 0 {
		systray.SetIcon(iconData)
	} else {
		// 内嵌一个最小的 16x16 ICO (蓝色小箱子)
		miniIcon := []byte{
			0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10, 0x00, 0x00, 0x01, 0x00,
			0x20, 0x00, 0x68, 0x04, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
		}
		systray.SetIcon(miniIcon)
	}
	systray.SetTitle("📦")
	systray.SetTooltip("库存管理系统 v2.0 - 运行中")

	// 菜单：打开本机
	mOpen := systray.AddMenuItem("打开管理页面 (本机)", "在浏览器中打开 http://localhost:8765")
	// 菜单：局域网地址
	ipText := "局域网地址: http://" + localIP + ":8765"
	mIP := systray.AddMenuItem(ipText, "复制局域网地址")
	// 分隔线
	systray.AddSeparator()
	// 菜单：开机自启
	mAutoStart := systray.AddMenuItem("开机自动启动", "注册/取消开机自启")
	mAutoStart.Check()
	// 菜单：数据目录
	mDataDir := systray.AddMenuItem("打开数据文件夹", "打开 data.json 所在目录")
	// 分隔线
	systray.AddSeparator()
	// 菜单：退出
	mQuit := systray.AddMenuItem("退出系统", "停止服务并退出")

	// 默认注册开机自启
	registerAutoStart()

	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				openBrowser(fmt.Sprintf("http://localhost:%d", httpPort))
			case <-mIP.ClickedCh:
				// 复制到剪贴板（Windows）
				url := fmt.Sprintf("http://%s:%d", localIP, httpPort)
				if runtime.GOOS == "windows" {
					exec.Command("clip").Run() // 简单方案，后续可改进
				}
				_ = url
			case <-mAutoStart.ClickedCh:
				if mAutoStart.Checked() {
					mAutoStart.Uncheck()
					// 取消自启
					if runtime.GOOS == "windows" {
						key := `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
						exec.Command("reg", "delete", key, "/v", "StockSystem", "/f").Run()
						log.Println("已取消开机自启")
					}
				} else {
					mAutoStart.Check()
					registerAutoStart()
				}
			case <-mDataDir.ClickedCh:
				exePath, _ := os.Executable()
				exeDir := filepath.Dir(exePath)
				if runtime.GOOS == "windows" {
					exec.Command("explorer", exeDir).Start()
				} else if runtime.GOOS == "darwin" {
					exec.Command("open", exeDir).Start()
				}
			case <-mQuit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

func onExit() {
	log.Println("库存管理系统已退出")
}

// =============================================================
// 主函数
// =============================================================

func main() {
	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)

	// 数据文件：优先放 exe 同目录
	dbPath := filepath.Join(exeDir, "data.json")
	f, err := os.OpenFile(dbPath, os.O_RDWR|os.O_CREATE, 0644)
	if err != nil {
		home, _ := os.UserHomeDir()
		dbPath = filepath.Join(home, "inventory_data.json")
		f, _ = os.OpenFile(dbPath, os.O_RDWR|os.O_CREATE, 0644)
	}
	if f != nil {
		f.Close()
	}

	dbFile = dbPath
	db = LoadOrCreateDB(dbFile)

	// 获取本机IP
	localIP = getLocalIP()

	// HTTP 路由
	http.HandleFunc("/api/", handleAPI)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" || path == "/" {
			path = "index.html"
		}
		data, err := staticEmbed.ReadFile("static/" + path)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		contentType := "text/plain; charset=utf-8"
		if strings.HasSuffix(path, ".html") {
			contentType = "text/html; charset=utf-8"
		} else if strings.HasSuffix(path, ".css") {
			contentType = "text/css; charset=utf-8"
		} else if strings.HasSuffix(path, ".js") {
			contentType = "application/javascript; charset=utf-8"
		} else if strings.HasSuffix(path, ".png") {
			contentType = "image/png"
		} else if strings.HasSuffix(path, ".ico") {
			contentType = "image/x-icon"
		}
		w.Header().Set("Content-Type", contentType)
		w.Write(data)
	})

	// 启动 HTTP 服务器
	go func() {
		log.Fatal(http.ListenAndServe(fmt.Sprintf("0.0.0.0:%d", httpPort), nil))
	}()

	// 等待服务器就绪后自动打开浏览器
	go func() {
		for i := 0; i < 10; i++ {
			time.Sleep(500 * time.Millisecond)
			resp, err := http.Get(fmt.Sprintf("http://localhost:%d", httpPort))
			if err == nil {
				resp.Body.Close()
				openBrowser(fmt.Sprintf("http://localhost:%d", httpPort))
				break
			}
		}
	}()

	// 优雅退出
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt)
		<-sig
		systray.Quit()
	}()

	log.Printf("库存管理系统 v2.0 启动完成 - 本机: http://localhost:%d - 局域网: http://%s:%d", httpPort, localIP, httpPort)

	// 启动系统托盘（阻塞）
	systray.Run(onReady, onExit)
}
